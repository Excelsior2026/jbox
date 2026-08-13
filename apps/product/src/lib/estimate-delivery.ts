import 'server-only';

import {
  customerAccessTokensConfigured,
} from '@/lib/customer-access-tokens';
import {
  issueCustomerAccessGrant,
} from '@/lib/customer-access-grants';
import { db } from '@/lib/db';
import {
  getEstimate,
  type EstimateRecord,
} from '@/lib/estimates';
import {
  requireOrganizationContext,
} from '@/lib/organization-context-store';
import {
  isResendConfigured,
  type EstimateDeliveryPayload,
} from '@/lib/outbox-dispatch';
import { loadInForceConfig } from '@/lib/tenant';
import { enqueueOutboxMessage } from '@/lib/transactional-outbox';

/**
 * Estimate customer delivery, jbox's equivalent of the prototype's
 * createEstimateDelivery. jbox has no version tables, price book, PDF
 * artifacts, or private storage: the estimate itself is the document, and
 * "delivery" means issuing the customer access links and queuing the
 * self-contained estimate_delivery email for the transactional-outbox drain.
 *
 * Runs in Field context (withFieldContext), so db() is RLS-scoped and the
 * canonical hostname for the link URLs is read from organization_domains.
 * Link URLs point at the tenant subdomain (https://<canonical hostname>/...).
 */

const ESTIMATE_LINK_DAYS = 14;
export const DEFAULT_ESTIMATE_TIME_ZONE = 'America/New_York';

export type EstimateDeliveryResult =
  | {
      ok: true;
      estimate: EstimateRecord;
      delivery: { status: 'queued'; expiresAt: string };
    }
  | { ok: false; reason:
      | 'estimate-not-found'
      | 'estimate-not-draft'
      | 'customer-email-missing'
      | 'delivery-not-configured'
      | 'link-tokens-not-configured'
      | 'tenant-host-not-found' };

function daysAfter(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isUsableEmail(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 320;
}

export async function createEstimateDelivery(options: {
  estimateId: string;
  timeZone: string;
}): Promise<EstimateDeliveryResult> {
  const context = requireOrganizationContext();

  const estimate = await getEstimate(options.estimateId);
  if (!estimate) return { ok: false, reason: 'estimate-not-found' };
  if (estimate.status !== 'draft') return { ok: false, reason: 'estimate-not-draft' };
  if (!isUsableEmail(estimate.customer.email)) {
    return { ok: false, reason: 'customer-email-missing' };
  }

  const config = await loadInForceConfig();
  if (!config || !isUsableEmail(config.contact.email)) {
    return { ok: false, reason: 'delivery-not-configured' };
  }
  if (!isResendConfigured()) {
    return { ok: false, reason: 'delivery-not-configured' };
  }
  if (!customerAccessTokensConfigured()) {
    return { ok: false, reason: 'link-tokens-not-configured' };
  }

  const domainRows = (await db().query(
    `SELECT domain.hostname
       FROM organization_domains AS domain
      WHERE domain.organization_id = app_current_organization_id()
        AND domain.verified
        AND domain.is_canonical
      LIMIT 1`,
  )) as Array<{ hostname: string }>;
  const hostname = domainRows[0]?.hostname;
  if (!hostname) return { ok: false, reason: 'tenant-host-not-found' };

  const issuedAt = new Date();
  const expiresAt = daysAfter(issuedAt, ESTIMATE_LINK_DAYS);
  const expiresAtIso = expiresAt.toISOString();

  // Both approve and decline ride the single sign-purpose link; the page uses
  // the intent query parameter to preselect the customer's choice.
  const baseUrl = `https://${hostname}`;

  let view: Awaited<ReturnType<typeof issueCustomerAccessGrant>>;
  let sign: Awaited<ReturnType<typeof issueCustomerAccessGrant>>;
  try {
    [view, sign] = await Promise.all([
      issueCustomerAccessGrant({
        customerId: estimate.customerId,
        documentId: estimate.id,
        resourceVersionId: null,
        purpose: 'estimate.view',
        expiresAt: expiresAtIso,
        createdBy: context.actorId,
      }),
      issueCustomerAccessGrant({
        customerId: estimate.customerId,
        documentId: estimate.id,
        resourceVersionId: null,
        purpose: 'estimate.sign',
        expiresAt: expiresAtIso,
        createdBy: context.actorId,
      }),
    ]);
  } catch (error) {
    // Grant issuance uses HMAC derivation; a missing/rotated secret surfaces
    // here as a hard failure rather than a half-queued delivery.
    throw error;
  }

  const payload: EstimateDeliveryPayload = {
    displayId: estimate.displayId,
    customerEmail: estimate.customer.email,
    from: config.contact.email,
    replyTo: config.contact.email,
    companyName: config.identity.businessName,
    timeZone: options.timeZone,
    expiresAt: expiresAtIso,
    viewUrl: `${baseUrl}/estimates/${view.token}`,
    approveUrl: `${baseUrl}/estimates/${sign.token}?intent=approve`,
    declineUrl: `${baseUrl}/estimates/${sign.token}?intent=decline`,
  };

  try {
    await enqueueOutboxMessage('estimate_delivery', crypto.randomUUID(), payload);
  } catch (error) {
    // The email never left the queue, so the just-issued links must not stay
    // live either; roll them back so a retry issues a fresh set.
    await revokeGrant(view.grant.id);
    await revokeGrant(sign.grant.id);
    throw error;
  }

  return {
    ok: true,
    estimate,
    delivery: { status: 'queued', expiresAt: expiresAtIso },
  };
}

async function revokeGrant(grantId: string) {
  try {
    await db().query(
      `UPDATE customer_access_grants
          SET status = 'revoked', revoked_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'active'`,
      [grantId],
    );
  } catch {
    // A failed cleanup leaves an orphaned link that simply expires in
    // ESTIMATE_LINK_DAYS; the active grant invariant prevents reuse.
  }
}
