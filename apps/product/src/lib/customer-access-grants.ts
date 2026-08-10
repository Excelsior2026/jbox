import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import type { CustomerAccessPurpose } from '@contractor-platform/domain';
import { db } from '@/lib/db';
import {
  customerAccessTokenKeyVersion,
  deriveCustomerAccessToken,
  hashCustomerAccessToken,
  type CustomerAccessTokenScope,
} from '@/lib/customer-access-tokens';

export type CustomerAccessGrantRecord = {
  id: string;
  customerId: string;
  documentType: 'estimate' | 'invoice';
  documentId: string;
  purpose: 'sign' | 'view';
  expiresAt: string;
};

type GrantRow = {
  id: string; customer_id: string; document_type: 'estimate' | 'invoice';
  document_id: string; purpose: 'sign' | 'view';
  status: 'active' | 'revoked' | 'consumed';
  key_version: string;
  expires_at: string | Date;
  expires_at_token?: string;
};

export function splitPurpose(purpose: CustomerAccessPurpose): {
  documentType: 'estimate' | 'invoice';
  purpose: 'sign' | 'view';
} {
  switch (purpose) {
    case 'estimate.sign':
      return { documentType: 'estimate', purpose: 'sign' };
    case 'estimate.view':
      return { documentType: 'estimate', purpose: 'view' };
    case 'invoice.view':
      return { documentType: 'invoice', purpose: 'view' };
  }
}

function toRecord(row: GrantRow): CustomerAccessGrantRecord {
  const expiresAt = row.expires_at_token ?? (row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at));
  return {
    id: row.id,
    customerId: row.customer_id,
    documentType: row.document_type,
    documentId: row.document_id,
    purpose: row.purpose,
    expiresAt,
  };
}

/**
 * Issues a customer access link. "One live link per (document, purpose)" is a
 * schema invariant (partial unique index in 005), so any previously active
 * grant for the same document+purpose is revoked in the same statement, then
 * the new grant is inserted. Returns the bearer token the caller embeds in the
 * email; only its SHA-256 hash is stored.
 */
export async function issueCustomerAccessGrant(options: {
  customerId: string;
  documentId: string;
  resourceVersionId: string | null;
  purpose: CustomerAccessPurpose;
  expiresAt: string;
  createdBy: string | null;
}): Promise<{ grant: CustomerAccessGrantRecord; token: string }> {
  const { documentType, purpose } = splitPurpose(options.purpose);
  const sql = db();

  // token_hash has a ^[a-f0-9]{64}$ CHECK, so the token (and its hash) must
  // exist before the insert. The scope is fully known ahead of time because
  // the grant id and organization come from context, not from the insert.
  const orgRows = (await sql.query('SELECT app_current_organization_id() AS organization_id')) as {
    organization_id: string;
  }[];
  const grantId = crypto.randomUUID();
  const scope: CustomerAccessTokenScope = {
    grantId,
    organizationId: orgRows[0].organization_id,
    resourceInternalId: options.documentId,
    resourceVersionId: options.resourceVersionId ?? '',
    purpose: options.purpose,
    keyVersion: customerAccessTokenKeyVersion(),
  };
  const token = deriveCustomerAccessToken(scope);
  const hash = hashCustomerAccessToken(token);

  const rows = (await sql.query(
    `WITH superseded AS (
       UPDATE customer_access_grants
       SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE document_type = $1
         AND document_id = $2
         AND purpose = $3
         AND status = 'active'
     ),
     issued AS (
       INSERT INTO customer_access_grants
         (id, organization_id, customer_id, document_type, document_id, purpose,
          token_hash, key_version, status, expires_at, created_by)
       SELECT $4, app_require_organization_id(), $5, $1, $2, $3, $6, $7, 'active', $8::timestamptz, $9
       RETURNING *,
         to_json(expires_at) AS expires_at_token
     )
     SELECT * FROM issued`,
    [
      documentType,
      options.documentId,
      purpose,
      grantId,
      options.customerId,
      hash,
      customerAccessTokenKeyVersion(),
      options.expiresAt,
      options.createdBy,
    ],
  )) as GrantRow[];

  return { grant: toRecord(rows[0]), token };
}

export type VerifyCustomerAccessGrantResult =
  | { ok: true; grant: CustomerAccessGrantRecord; scope: CustomerAccessTokenScope }
  | { ok: false; reason: 'not-found' | 'expired' | 'inactive' | 'revoked' | 'consumed' | 'mismatch' };

/**
 * Verifies a bearer token against the grant it was issued for. Runs in tenant
 * context (the customer host resolves the organization). Only the token's
 * SHA-256 hash is stored, so verification re-derives the expected token from
 * the current document state and compares it to the presented one.
 */
export async function verifyCustomerAccessGrant(options: {
  token: string;
  documentType: 'estimate' | 'invoice';
  documentId: string;
  resourceVersionId: string | null;
  purpose: CustomerAccessPurpose;
}): Promise<VerifyCustomerAccessGrantResult> {
  const { purpose } = splitPurpose(options.purpose);
  const sql = db();
  const tokenHash = hashCustomerAccessToken(options.token);

  const rows = (await sql.query(
    `SELECT *, to_json(expires_at) AS expires_at_token
       FROM customer_access_grants
      WHERE token_hash = $1`,
    [tokenHash],
  )) as GrantRow[];
  const grant = rows[0];
  if (!grant) return { ok: false, reason: 'not-found' };
  if (grant.status !== 'active') return { ok: false, reason: grant.status };
  if (grant.document_type !== options.documentType || grant.document_id !== options.documentId || grant.purpose !== purpose) {
    return { ok: false, reason: 'mismatch' };
  }

  const expiresAt = grant.expires_at instanceof Date ? grant.expires_at.toISOString() : String(grant.expires_at);
  if (new Date(expiresAt).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const scope: CustomerAccessTokenScope = {
    grantId: grant.id,
    organizationId: '', // from context below
    resourceInternalId: options.documentId,
    resourceVersionId: options.resourceVersionId ?? '',
    purpose: options.purpose,
    keyVersion: grant.key_version,
  };
  const orgRows = (await sql.query('SELECT app_current_organization_id() AS organization_id')) as {
    organization_id: string;
  }[];
  scope.organizationId = orgRows[0].organization_id;

  const expected = deriveCustomerAccessToken(scope);
  if (
    expected.length !== options.token.length
    || !timingSafeEqual(Buffer.from(expected), Buffer.from(options.token))
  ) {
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true, grant: toRecord(grant), scope };
}

/** Marks a sign grant consumed, making its token single-use. */
export async function consumeCustomerAccessGrant(
  grantId: string,
): Promise<void> {
  const sql = db();
  await sql.query(
    `UPDATE customer_access_grants
        SET status = 'consumed', consumed_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [grantId],
  );
}

export async function revokeCustomerAccessGrant(grantId: string): Promise<void> {
  const sql = db();
  await sql.query(
    `UPDATE customer_access_grants
        SET status = 'revoked', revoked_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [grantId],
  );
}
