import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { createBillingPortalSession, isStripeConfigured } from '@/lib/stripe';
import { platformDb } from '@/lib/db';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { fieldPrincipalCan } from '@/lib/field-api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/billing/portal
 *
 * Creates a Stripe Billing Portal session for the authenticated tenant owner.
 * Returns the redirect URL. Only the 'owner' role may access billing settings.
 *
 * Body: { returnUrl } (optional — defaults to the field dashboard)
 */
export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isStripeConfigured()) {
    return privateJson({ ok: false, error: 'Billing is not configured.' }, 503);
  }

  let body: { returnUrl?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // returnUrl is optional
  }

  const returnUrl = typeof body.returnUrl === 'string'
    ? body.returnUrl
    : 'https://field.usejbox.com/field';

  try {
    const stripeCustomerId = await withFieldContext(principal, async () => {
      const rows = await platformDb().query(
        `SELECT resolve_organization_stripe_customer($1) AS stripe_customer_id`,
        [principal.organizationId],
      );
      return (rows[0] as Record<string, unknown> | undefined)?.stripe_customer_id as string | null;
    });

    if (!stripeCustomerId) {
      return privateJson({ ok: false, error: 'No billing account found for this organization.' }, 404);
    }

    const { url } = await createBillingPortalSession({ stripeCustomerId, returnUrl });
    return privateJson({ ok: true, url }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'billing portal unavailable';
    return privateJson({ ok: false, error: message }, 502);
  }
}
