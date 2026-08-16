import type { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { fieldPrincipalCan } from '@/lib/field-api-auth';
import { createBillingPortalSession, isStripeConfigured } from '@/lib/stripe';
import { platformDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/billing/portal-redirect
 *
 * Form-action-compatible route that creates a Stripe Billing Portal session
 * and performs a server-side redirect. Accepts both GET (from link) and POST
 * (from form). Only accessible to authenticated owners.
 */
export async function POST(_request: NextRequest) {
  return handlePortalRedirect();
}

export async function GET(_request: NextRequest) {
  return handlePortalRedirect();
}

async function handlePortalRedirect() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!isStripeConfigured()) {
    redirect('/field');
  }

  const stripeCustomerId = await withFieldContext(principal, async () => {
    const rows = await platformDb().query(
      `SELECT stripe_customer_id FROM organizations WHERE id = $1`,
      [principal.organizationId],
    ) as Array<{ stripe_customer_id: string | null }>;
    return rows[0]?.stripe_customer_id ?? null;
  });

  if (!stripeCustomerId) {
    redirect('/field');
  }

  const { url } = await createBillingPortalSession({
    stripeCustomerId,
    returnUrl: 'https://field.usejbox.com/field',
  });

  redirect(url);
}
