import 'server-only';

import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';

export type IdempotencyKeyStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

export type IdempotencyKeyRecord = {
  id: string;
  keyHash: string;
  documentType: 'invoice' | 'estimate' | 'deposit';
  documentId: string;
  amountCents: number;
  currency: string;
  status: IdempotencyKeyStatus;
  stripePaymentIntentId: string | null;
  stripePaymentMethodId: string | null;
  processedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  actorId: string | null;
  requestIp: string | null;
  createdAt: string;
  updatedAt: string;
};

type IdempotencyRow = Record<string, unknown>;

const timestampToken = (row: IdempotencyRow, column: string) => {
  const exactToken = row[`${column}_token`];
  if (typeof exactToken === 'string') return exactToken;
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
};

function mapIdempotencyKey(row: IdempotencyRow): IdempotencyKeyRecord {
  return {
    id: row.id as string,
    keyHash: row.key_hash as string,
    documentType: row.document_type as 'invoice' | 'estimate' | 'deposit',
    documentId: row.document_id as string,
    amountCents: Number(row.amount_cents),
    currency: row.currency as string,
    status: row.status as IdempotencyKeyStatus,
    stripePaymentIntentId: (row.stripe_payment_intent_id as string) ?? null,
    stripePaymentMethodId: (row.stripe_payment_method_id as string) ?? null,
    processedAt: row.processed_at ? timestampToken(row, 'processed_at') : null,
    failedAt: row.failed_at ? timestampToken(row, 'failed_at') : null,
    failureReason: (row.failure_reason as string) ?? null,
    actorId: (row.actor_id as string) ?? null,
    requestIp: (row.request_ip as string) ?? null,
    createdAt: timestampToken(row, 'created_at'),
    updatedAt: timestampToken(row, 'updated_at'),
  };
}

export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateIdempotencyKey(): string {
  return randomBytes(32).toString('hex');
}

export async function acquireIdempotencyKey(
  keyHash: string,
  documentType: 'invoice' | 'estimate' | 'deposit',
  documentId: string,
  amountCents: number,
): Promise<{ id: string; existing: boolean } | null> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const requestId = requireOrganizationContext().requestId;

  const existing = (await sql.query(
    `SELECT id, status FROM idempotency_keys
     WHERE key_hash = $1
       AND organization_id = app_require_organization_id()
       AND document_type = $2
       AND document_id = $3
       AND amount_cents = $4`,
    [keyHash, documentType, documentId, amountCents],
  )) as { id: string; status: string }[];

  if (existing.length) {
    if (existing[0].status === 'completed') {
      return { id: existing[0].id, existing: true };
    }
    if (existing[0].status === 'pending' || existing[0].status === 'processing') {
      return null;
    }
    if (existing[0].status === 'failed' || existing[0].status === 'expired') {
      await sql`
        DELETE FROM idempotency_keys
        WHERE id = ${existing[0].id}::uuid
          AND organization_id = app_require_organization_id()
      `;
    }
  }

  const inserted = (await sql`
    INSERT INTO idempotency_keys
      (organization_id, key_hash, document_type, document_id, amount_cents, status, actor_id, request_ip)
    VALUES (
      app_require_organization_id(), ${keyHash}, ${documentType}, ${documentId}::uuid,
      ${amountCents}, 'pending', ${actorId}, ${requestId}
    )
    ON CONFLICT (organization_id, key_hash) DO UPDATE
      SET updated_at = now()
    RETURNING id
  `) as { id: string }[];

  if (!inserted.length) return null;
  return { id: inserted[0].id, existing: false };
}

export async function markProcessing(id: string): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    UPDATE idempotency_keys
    SET status = 'processing', updated_at = now()
    WHERE id = ${id}::uuid
      AND organization_id = app_require_organization_id()
      AND status = 'pending'
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

export async function markCompleted(
  id: string,
  stripePaymentIntentId?: string,
  stripePaymentMethodId?: string,
): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    UPDATE idempotency_keys
    SET status = 'completed',
        processed_at = now(),
        stripe_payment_intent_id = COALESCE(${stripePaymentIntentId ?? null}::text, stripe_payment_intent_id),
        stripe_payment_method_id = COALESCE(${stripePaymentMethodId ?? null}::text, stripe_payment_method_id),
        updated_at = now()
    WHERE id = ${id}::uuid
      AND organization_id = app_require_organization_id()
      AND status = 'processing'
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

export async function markFailed(id: string, failureReason: string): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    UPDATE idempotency_keys
    SET status = 'failed',
        failed_at = now(),
        failure_reason = ${failureReason},
        updated_at = now()
    WHERE id = ${id}::uuid
      AND organization_id = app_require_organization_id()
      AND status IN ('pending', 'processing')
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

export async function getIdempotencyKey(keyHash: string): Promise<IdempotencyKeyRecord | null> {
  const sql = db();
  const rows = (await sql.query(
    `SELECT
       id, key_hash, document_type, document_id, amount_cents, currency, status,
       stripe_payment_intent_id, stripe_payment_method_id,
       processed_at, failed_at, failure_reason, actor_id, request_ip,
       created_at, updated_at
     FROM idempotency_keys
     WHERE key_hash = $1
       AND organization_id = app_require_organization_id()`,
    [keyHash],
  )) as IdempotencyRow[];
  if (!rows.length) return null;
  return mapIdempotencyKey(rows[0]);
}
