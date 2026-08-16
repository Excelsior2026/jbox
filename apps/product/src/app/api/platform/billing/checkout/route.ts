import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { createCheckoutSession, isStripeConfigured, STRIPE_TRIAL_DAYS } from '@/lib/stripe';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/billing/checkout
 *
 * Creates a Stripe Checkout Session for the newly provisioned tenant and
 * returns the redirect URL. Called immediately after /api/platform/onboarding
 * succeeds. The client redirects the browser to the returned URL.
 *
 * Body: { organizationId, slug, email, businessName }
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`billing-checkout:${ip}`, { capacity: 10, refillPerMinute: 5 }))) {
    return privateJson({ error: 'too-many-requests' }, 429);
  }

  if (!isStripeConfigured()) {
    // Graceful degradation: if Stripe is not configured, skip billing and
    // direct the user straight to the success page. This keeps dev and
    // unmonetised deployments working without Stripe credentials.
    return privateJson({
      ok: true,
      skipBilling: true,
      message: `Your ${STRIPE_TRIAL_DAYS}-day free trial has started. Stripe billing is not configured on this deployment.`,
    }, 200);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'invalid-body' }, 400);
  }

  const rec = body as Record<string, unknown>;
  const organizationId = typeof rec.organizationId === 'string' ? rec.organizationId.trim() : '';
  const slug = typeof rec.slug === 'string' ? rec.slug.trim() : '';
  const email = typeof rec.email === 'string' ? rec.email.trim() : '';
  const businessName = typeof rec.businessName === 'string' ? rec.businessName.trim() : '';

  if (!organizationId || !slug) {
    return privateJson({ error: 'organizationId and slug are required' }, 400);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://usejbox.com';

  try {
    const { url } = await createCheckoutSession({
      organizationId,
      slug,
      email,
      businessName,
      successUrl: `${baseUrl}/platform/onboarding/success`,
      cancelUrl: `${baseUrl}/platform/onboarding`,
    });
    return privateJson({ ok: true, url }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'billing setup failed';
    return privateJson({ ok: false, error: message }, 502);
  }
}
