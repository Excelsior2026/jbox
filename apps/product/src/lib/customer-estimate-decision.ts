import 'server-only';

import { db } from '@/lib/db';
import {
  customerAccessTokenHasValidSyntax,
  hashCustomerAccessToken,
} from '@/lib/customer-access-tokens';
import {
  consumeCustomerAccessGrant,
  verifyCustomerAccessGrant,
} from '@/lib/customer-access-grants';
import {
  declineEstimate,
  getEstimate,
  signEstimate,
} from '@/lib/estimates';

/**
 * Customer estimate decision. The customer opens a sign-purpose link from the
 * delivery email and chooses to approve (sign with their name) or decline.
 *
 * jbox has no version tables: the estimate itself is the document and the
 * grant's document_id is the estimate id. A decision rides the same transitions
 * the Field app uses — signEstimate()/declineEstimate() — plus consuming the
 * single-use grant. "Stale" (prototype) does not exist here: a re-issued link
 * revokes the previous active grant in the same insert (one-active-grant
 * invariant in 005), so the only states are unused, used, expired, or gone.
 */

export type CustomerEstimateDecisionInput = {
  decision: 'approved' | 'declined';
  signerName: string;
  affirmativeConsent: boolean;
  ip: string;
  userAgent: string | null;
};

export type CustomerEstimateDecisionResult =
  | { ok: true; decision: 'approved' | 'declined'; reused: boolean }
  | { ok: false; reason: 'invalid' | 'not-found' | 'expired' | 'already-decided' };

const MIN_SIGNER_NAME = 2;
const MAX_SIGNER_NAME = 120;

type GrantRow = {
  id: string;
  document_id: string;
};

export async function decideCustomerEstimate(
  token: string,
  input: CustomerEstimateDecisionInput,
): Promise<CustomerEstimateDecisionResult> {
  if (
    !customerAccessTokenHasValidSyntax(token)
    || (input.decision === 'approved' && (
      !input.affirmativeConsent
      || input.signerName.trim().length < MIN_SIGNER_NAME
      || input.signerName.trim().length > MAX_SIGNER_NAME
    ))
    || (input.decision === 'declined' && input.affirmativeConsent)
  ) {
    return { ok: false, reason: 'invalid' };
  }

  // The decision URL is token-only, but verification needs the document id, so
  // first resolve the grant (RLS-scoped to the tenant context the customer host
  // established) and then run the canonical token verification.
  const rows = (await db().query(
    `SELECT grant.id, grant.document_id
       FROM customer_access_grants AS grant
      WHERE grant.token_hash = $1
        AND grant.document_type = 'estimate'
        AND grant.purpose = 'sign'
      LIMIT 1`,
    [hashCustomerAccessToken(token)],
  )) as GrantRow[];
  const grant = rows[0];
  if (!grant) return { ok: false, reason: 'not-found' };

  const verified = await verifyCustomerAccessGrant({
    token,
    documentType: 'estimate',
    documentId: grant.document_id,
    resourceVersionId: null,
    purpose: 'estimate.sign',
  });
  if (!verified.ok) {
    if (verified.reason === 'expired') return { ok: false, reason: 'expired' };
    if (verified.reason === 'revoked' || verified.reason === 'consumed') {
      return { ok: false, reason: 'already-decided' };
    }
    return { ok: false, reason: 'not-found' };
  }

  const estimate = await getEstimate(grant.document_id);
  if (!estimate) return { ok: false, reason: 'not-found' };
  if (estimate.status !== 'draft') return { ok: false, reason: 'already-decided' };

  const ctx = { ip: input.ip, userAgent: input.userAgent };
  const outcome = input.decision === 'approved'
    ? await signEstimate(grant.document_id, {
        signerName: input.signerName.trim(),
        signatureContext: 'protected-published',
      }, ctx)
    : await declineEstimate(grant.document_id, ctx);

  if (!outcome.ok) {
    if (outcome.reason === 'not-found') return { ok: false, reason: 'not-found' };
    if (outcome.reason === 'invalid-context') return { ok: false, reason: 'invalid' };
    return { ok: false, reason: 'already-decided' };
  }

  await consumeCustomerAccessGrant(grant.id);
  return { ok: true, decision: input.decision, reused: false };
}
