import type { NextRequest } from 'next/server';
import { platformDb } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { constructWebhookEvent, extractSubscriptionState, isStripeWebhookConfigured } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/billing/webhook
 *
 * Stripe webhook receiver. Handles subscription lifecycle events:
 *   - checkout.session.completed  → link Stripe customer to organization
 *   - customer.subscription.created / updated / deleted → sync status
 *
 * Security: Stripe signs every webhook with STRIPE_WEBHOOK_SECRET. The
 * constructWebhookEvent() wrapper rejects any request with an invalid
 * signature before any DB write happens. This endpoint is intentionally
 * unauthenticated (Stripe calls it directly); the signature is the auth.
 *
 * Idempotency: Stripe may deliver the same event more than once. All updates
 * use SET ... WHERE stripe_customer_id = $1, which is idempotent.
 */
export async function POST(request: NextRequest) {
  if (!isStripeWebhookConfigured()) {
    return privateJson({ ok: false, error: 'Webhook not configured.' }, 503);
  }

  const signature = request.headers.get('stripe-signature') ?? '';
  const rawBody = await request.text();

  const event = constructWebhookEvent(rawBody, signature);
  if (!event) {
    return privateJson({ ok: false, error: 'Invalid signature.' }, 400);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = typeof session.customer === 'string'
          ? session.customer
          : (session.customer?.id ?? null);
        const organizationId = session.metadata?.organizationId;

        if (customerId && organizationId) {
          await platformDb().query(
            'SELECT link_stripe_customer($1::uuid, $2)',
            [organizationId, customerId],
          );
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const state = extractSubscriptionState(subscription);
        await platformDb().query(
          `SELECT sync_stripe_subscription($1, $2, $3, $4, $5::timestamptz)`,
          [
            state.stripeCustomerId,
            state.stripeSubscriptionId,
            state.status,
            state.plan,
            state.currentPeriodEnd?.toISOString() ?? null,
          ],
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const state = extractSubscriptionState(subscription);
        await platformDb().query(
          `SELECT sync_stripe_subscription($1, $2, $3, $4, $5::timestamptz)`,
          [
            state.stripeCustomerId,
            state.stripeSubscriptionId,
            'canceled',
            state.plan,
            state.currentPeriodEnd?.toISOString() ?? null,
          ],
        );
        break;
      }

      // Unhandled event types are acknowledged but not processed.
      default:
        break;
    }

    return privateJson({ ok: true, received: event.type }, 200);
  } catch (error) {
    // Log but return 200 so Stripe does not retry indefinitely on a logic error
    // that will never resolve. Stripe will retry on 5xx, so only infrastructure
    // failures should return 500.
    console.error(`Stripe webhook handler failed for ${event.type}:`, error);
    return privateJson({ ok: false, error: 'Handler error.' }, 500);
  }
}
