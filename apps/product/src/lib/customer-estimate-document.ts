import 'server-only';

import {
  customerAccessTokenHasValidSyntax,
  hashCustomerAccessToken,
} from '@/lib/customer-access-tokens';
import { verifyCustomerAccessGrant } from '@/lib/customer-access-grants';
import { db } from '@/lib/db';
import { getEstimate, type EstimateRecord } from '@/lib/estimates';

/**
 * Loads the estimate a customer-access token opens, for the /estimates/[token]
 * page. Accepts either purpose — the view link shows the document, the sign
 * link shows it plus the decision form — and keeps a consumed sign link
 * viewable so a customer who already responded can see the outcome.
 */

export type CustomerEstimateDocument = {
  estimate: EstimateRecord;
  purpose: 'view' | 'sign';
  expiresAt: string;
};

type GrantRow = {
  id: string;
  document_id: string;
  purpose: 'view' | 'sign';
};

export async function loadCustomerEstimateDocument(
  token: string,
): Promise<CustomerEstimateDocument | null> {
  if (!customerAccessTokenHasValidSyntax(token)) return null;

  // Token-only URL: resolve the grant first (RLS-scoped to the tenant context
  // the customer host established), then run canonical verification.
  const rows = (await db().query(
    `SELECT grant.id, grant.document_id, grant.purpose
       FROM customer_access_grants AS grant
      WHERE grant.token_hash = $1
        AND grant.document_type = 'estimate'
      LIMIT 1`,
    [hashCustomerAccessToken(token)],
  )) as GrantRow[];
  const grant = rows[0];
  if (!grant) return null;

  const verified = await verifyCustomerAccessGrant({
    token,
    documentType: 'estimate',
    documentId: grant.document_id,
    resourceVersionId: null,
    purpose: grant.purpose === 'sign' ? 'estimate.sign' : 'estimate.view',
    allowConsumed: true,
  });
  if (!verified.ok) return null;

  const estimate = await getEstimate(grant.document_id);
  if (!estimate) return null;

  return {
    estimate,
    purpose: grant.purpose,
    expiresAt: verified.grant.expiresAt,
  };
}
