import 'server-only';

import type {
  OrganizationMembershipJSON,
  UserJSON,
  WebhookEvent,
} from '@clerk/nextjs/server';
import { createHash } from 'node:crypto';
import { applicationRoleForClerkRole } from '@/lib/identity';
import { platformDb } from '@/lib/db';

type EntityKind = 'user' | 'organization' | 'membership' | 'other';

type WebhookEntity = {
  kind: EntityKind;
  id: string;
};

export function hashWebhookPayload(payload: string) {
  return createHash('sha256').update(payload).digest('hex');
}

export function webhookEntity(event: WebhookEvent): WebhookEntity {
  const id = 'id' in event.data ? event.data.id : undefined;
  if (typeof id !== 'string' || id.length < 1 || id.length > 200) {
    throw new Error('identity_event_missing_entity');
  }

  if (event.type.startsWith('user.')) return { kind: 'user', id };
  if (event.type.startsWith('organizationMembership.')) {
    return { kind: 'membership', id };
  }
  if (event.type.startsWith('organization.')) {
    return { kind: 'organization', id };
  }
  return { kind: 'other', id };
}

export function webhookOccurredAt(rawPayload: string) {
  try {
    const envelope = JSON.parse(rawPayload) as { timestamp?: unknown };
    if (
      typeof envelope.timestamp === 'number'
      && Number.isFinite(envelope.timestamp)
      && envelope.timestamp > 0
    ) {
      return new Date(envelope.timestamp);
    }
  } catch {
    // The verified webhook processor will reject malformed JSON separately.
  }
  throw new Error('identity_event_missing_timestamp');
}

function primaryEmail(data: UserJSON) {
  const email = data.email_addresses.find(
    (candidate) => candidate.id === data.primary_email_address_id,
  )?.email_address ?? data.email_addresses[0]?.email_address;
  return (
    email?.trim().toLowerCase().slice(0, 320)
    || `${data.id}@identity.invalid`
  );
}

function membershipEmail(data: OrganizationMembershipJSON) {
  const identifier = data.public_user_data.identifier.trim().toLowerCase();
  return identifier.includes('@')
    ? identifier.slice(0, 320)
    : `${data.public_user_data.user_id}@identity.invalid`;
}

function displayName(firstName: string | null, lastName: string | null) {
  const value = [firstName, lastName].filter(Boolean).join(' ').trim();
  return value.slice(0, 160) || 'Staff member';
}

function organizationExternalId(event: WebhookEvent) {
  switch (event.type) {
    case 'organizationMembership.created':
    case 'organizationMembership.updated':
    case 'organizationMembership.deleted':
      return event.data.organization.id;
    case 'organization.created':
    case 'organization.updated':
    case 'organization.deleted':
      return event.data.id ?? null;
    default:
      return null;
  }
}

/**
 * The freshness guard. A webhook event must be the newest the ledger has seen
 * for its entity before it may apply side effects; otherwise an out-of-order
 * redelivery would let a stale state clobber a newer one. The payload fields
 * are pinned too, so a same-id/different-content replay never applies side
 * effects (and is surfaced as a collision by the final UPDATE).
 *
 * Mirrors the prototype's fresh_event CTE against the jbox ledger columns.
 */
function freshEventCte() {
  return `
    fresh_event AS (
      SELECT 1
      FROM clerk_webhook_events AS current_event
      WHERE current_event.id = $1
        AND current_event.payload_hash = $2
        AND current_event.event_type = $3
        AND current_event.entity_kind = $4
        AND current_event.external_entity_id = $5
        AND NOT EXISTS (
          SELECT 1
          FROM clerk_webhook_events AS newer_event
          WHERE newer_event.entity_kind = current_event.entity_kind
            AND newer_event.external_entity_id = current_event.external_entity_id
            AND (
              newer_event.occurred_at > current_event.occurred_at
              OR (
                newer_event.occurred_at = current_event.occurred_at
                AND newer_event.id > current_event.id
              )
            )
        )
    )
  `;
}

/**
 * Applies a Clerk webhook event to the identity store, exactly once per event
 * and never out of order.
 *
 * Runs on platformDb() with no tenant: the webhook has no Host header and no
 * tenant, and the identity tables are platform-owned. All writes flow through
 * the SECURITY DEFINER windows from migration 005 — the same narrow functions
 * the check suite exercises — so the ledger is appended here while the identity
 * rows are changed only where the schema allows.
 */
export async function processClerkWebhookEvent(options: {
  eventId: string;
  event: WebhookEvent;
  rawPayload: string;
  occurredAt: Date;
}) {
  const { event, eventId, rawPayload, occurredAt } = options;
  const entity = webhookEntity(event);
  const payloadHash = hashWebhookPayload(rawPayload);
  const externalOrganizationId = organizationExternalId(event);
  const lockKey = `${entity.kind}:${entity.id}`;

  const ledgerInsert = {
    text: `
      INSERT INTO clerk_webhook_events (
        id,
        organization_id,
        event_type,
        payload_hash,
        occurred_at,
        entity_kind,
        external_entity_id
      )
      VALUES (
        $1,
        (
          SELECT id
          FROM organizations
          WHERE clerk_organization_id = $2
        ),
        $3,
        $4,
        $5,
        $6,
        $7
      )
      ON CONFLICT (id) DO NOTHING
    `,
    params: [
      eventId,
      externalOrganizationId,
      event.type,
      payloadHash,
      occurredAt.toISOString(),
      entity.kind,
      entity.id,
    ],
  };

  const finalUpdate = {
    text: `
      UPDATE clerk_webhook_events
      SET
        organization_id = coalesce(
          organization_id,
          (
            SELECT id
            FROM organizations
            WHERE clerk_organization_id = $2
          )
        ),
        processed_at = now(),
        processing_error_code = CASE
          WHEN payload_hash = $3
            AND event_type = $4
            AND entity_kind = $5
            AND external_entity_id = $6
          THEN NULL
          ELSE 'identity_event_id_collision'
        END
      WHERE id = $1
      RETURNING processing_error_code
    `,
    params: [
      eventId,
      externalOrganizationId,
      payloadHash,
      event.type,
      entity.kind,
      entity.id,
    ],
  };

  const guarded = (call: string, extraParams: unknown[]) => ({
    text: `
      WITH ${freshEventCte()}
      SELECT ${call}
      FROM fresh_event
    `,
    params: [
      eventId,
      payloadHash,
      event.type,
      entity.kind,
      entity.id,
      ...extraParams,
    ],
  });

  if (event.type === 'user.created' || event.type === 'user.updated') {
    const user = event.data;
    return runWebhookTransaction(lockKey, ledgerInsert, [
      guarded('upsert_platform_user($6, $7, $8, $9)', [
        user.id,
        primaryEmail(user),
        displayName(user.first_name, user.last_name),
        !(user.banned || user.locked),
      ]),
    ], finalUpdate);
  }

  if (event.type === 'user.deleted') {
    return runWebhookTransaction(lockKey, ledgerInsert, [
      guarded('deactivate_platform_user($6)', [entity.id]),
    ], finalUpdate);
  }

  if (event.type === 'organization.created' || event.type === 'organization.updated') {
    // Organizations are provisioned by the control plane, which sets
    // clerk_organization_id via link_organization_clerk. There is nothing for
    // the webhook to change: the ledger row is the record.
    return runWebhookTransaction(lockKey, ledgerInsert, [], finalUpdate);
  }

  if (event.type === 'organization.deleted') {
    return runWebhookTransaction(lockKey, ledgerInsert, [
      guarded('suspend_organization_by_clerk_id($6)', [entity.id]),
    ], finalUpdate);
  }

  if (
    event.type === 'organizationMembership.created'
    || event.type === 'organizationMembership.updated'
  ) {
    const membership = event.data;
    const role = applicationRoleForClerkRole(membership.role);
    if (!role) throw new Error('identity_membership_role_unsupported');

    return runWebhookTransaction(lockKey, ledgerInsert, [
      guarded('upsert_clerk_membership($6, $7, $8, $9, $10, $11, $12)', [
        membership.organization.id,
        membership.public_user_data.user_id,
        membershipEmail(membership),
        displayName(
          membership.public_user_data.first_name,
          membership.public_user_data.last_name,
        ),
        membership.id,
        role,
        role === 'owner',
      ]),
    ], finalUpdate);
  }

  if (event.type === 'organizationMembership.deleted') {
    const membership = event.data;
    return runWebhookTransaction(lockKey, ledgerInsert, [
      guarded('revoke_clerk_membership($6)', [membership.id]),
    ], finalUpdate);
  }

  return runWebhookTransaction(lockKey, ledgerInsert, [], finalUpdate);
}

async function runWebhookTransaction(
  lockKey: string,
  ledgerInsert: { text: string; params: unknown[] },
  sideEffects: Array<{ text: string; params: unknown[] }>,
  finalUpdate: { text: string; params: unknown[] },
) {
  const results = await platformDb().transaction((transaction) => [
    transaction.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [lockKey],
    ),
    transaction.query(ledgerInsert.text, ledgerInsert.params),
    ...sideEffects.map((sideEffect) => (
      transaction.query(sideEffect.text, sideEffect.params)
    )),
    transaction.query(finalUpdate.text, finalUpdate.params),
  ]);

  const collision = results[results.length - 1]?.[0]?.processing_error_code;
  if (collision) {
    // A same-id webhook redelivery carrying different content. The side
    // effects were skipped by the freshness guard; record it loudly so it
    // cannot pass silently.
    console.error('Clerk webhook event id collision.', { eventId: ledgerInsert.params[0], collision });
  }
}
