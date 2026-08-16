import 'server-only';

import Stripe from 'stripe';

/**
 * Stripe billing helpers.
 *
 * All Stripe API calls are server-side only. The restricted API key (rk_ prefix)
 * never reaches the browser. Key capabilities required on the RAK:
 *   - customers: write
 *   - checkout_sessions: write
 *   - subscriptions: read
 *   - billing_portal.sessions: write
 *   - webhook_endpoints: (optional, for programmatic registration)
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? '';
export const STRIPE_TRIAL_DAYS = Number(process.env.STRIPE_TRIAL_DAYS ?? 14);

export function isStripeConfigured(): boolean {
  return Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(STRIPE_WEBHOOK_SECRET);
}

function stripeClient(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  return new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2025-08-27.basil',
    typescript: true,
  });
}

/**
 * Creates a Stripe Customer for the newly provisioned tenant, links the
 * customer id back to the organization via the control plane function, and
 * returns a Checkout Session URL the wizard can redirect the user to.
 *
 * Uses Checkout Sessions in subscription mode — Stripe handles the payment
 * form, SCA, and trial management automatically.
 */
export async function createCheckoutSession(options: {
  organizationId: string;
  slug: string;
  email: string;
  businessName: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_PRICE_ID missing).');
  }
  const stripe = stripeClient();

  // Create or retrieve the Stripe Customer, keyed on the organization id stored
  // in metadata so webhooks can recover it if the DB link is ever lost.
  const customer = await stripe.customers.create({
    email: options.email || undefined,
    name: options.businessName || undefined,
    metadata: {
      organizationId: options.organizationId,
      slug: options.slug,
    },
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    // Never include payment_method_types — let Stripe dynamically select the
    // best methods per Dashboard configuration.
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    subscription_data: {
      trial_period_days: STRIPE_TRIAL_DAYS,
      metadata: {
        organizationId: options.organizationId,
        slug: options.slug,
      },
    },
    // Stripe populates {CHECKOUT_SESSION_ID} at redirect time.
    success_url: `${options.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: options.cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  });

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout Session URL.');
  }

  return { url: session.url };
}

/**
 * Creates a Stripe Billing Portal session so the tenant owner can manage
 * their subscription (payment method, plan change, cancellation).
 */
export async function createBillingPortalSession(options: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const stripe = stripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: options.stripeCustomerId,
    return_url: options.returnUrl,
  });
  return { url: session.url };
}

/**
 * Constructs and verifies an inbound Stripe webhook event. Returns null when
 * the signature check fails (replay or tampered payload).
 */
export function constructWebhookEvent(
  rawBody: string,
  signature: string,
): Stripe.Event | null {
  if (!STRIPE_WEBHOOK_SECRET) return null;
  try {
    return stripeClient().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch {
    return null;
  }
}

export type StripeSubscriptionState = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  plan: string | null;
  currentPeriodEnd: Date | null;
};

/**
 * Extracts the subscription state the DB needs from a Stripe Subscription
 * object. Used by the webhook handler for both create and update events.
 */
export function extractSubscriptionState(
  subscription: Stripe.Subscription,
): StripeSubscriptionState {
  const item = subscription.items.data[0];
  const plan = item?.price?.lookup_key ?? item?.price?.id ?? null;
  // Stripe v2 uses billing_cycle_anchor; cancel_at covers upcoming period end.
  const periodEndTs = subscription.cancel_at ?? subscription.billing_cycle_anchor;
  const periodEnd = periodEndTs ? new Date(periodEndTs * 1000) : null;
  return {
    stripeCustomerId: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    plan,
    currentPeriodEnd: periodEnd,
  };
}
