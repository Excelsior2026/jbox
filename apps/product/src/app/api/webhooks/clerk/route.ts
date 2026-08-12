import { verifyWebhook } from '@clerk/nextjs/webhooks';
import type { NextRequest } from 'next/server';
import {
  processClerkWebhookEvent,
  webhookOccurredAt,
} from '@/lib/clerk-webhook-sync';
import { isDatabaseConfigured } from '@/lib/db';
import { privateText, PRIVATE_HEADERS } from '@/lib/http';
import { isClerkIdentityConfigured } from '@/lib/identity-environment';

export const dynamic = 'force-dynamic';

const MAX_WEBHOOK_BYTES = 1024 * 1024;

/**
 * Clerk identity webhook receiver. The webhook arrives with no Host header and
 * therefore no tenant, so it runs on the platform client end to end — the
 * ledger insert and every side effect flow through the SECURITY DEFINER windows
 * from migration 005 (see lib/clerk-webhook-sync.ts).
 *
 * Fails closed: if identity or the database is not configured, Clerk's retries
 * see a 503 and keep trying rather than a 2xx that would silently drop events.
 */
export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
  if (!isClerkIdentityConfigured() || !signingSecret || !isDatabaseConfigured()) {
    return privateText('Identity webhook is not configured.', 503);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return privateText('Payload too large.', 413);
  }

  let rawPayload: string;
  try {
    rawPayload = await request.clone().text();
  } catch {
    return privateText('Invalid webhook payload.', 400);
  }
  if (Buffer.byteLength(rawPayload, 'utf8') > MAX_WEBHOOK_BYTES) {
    return privateText('Payload too large.', 413);
  }

  let event;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch (error) {
    console.error('Clerk webhook verification failed.', {
      code: error instanceof Error ? error.name : 'unknown_error',
    });
    return privateText('Webhook verification failed.', 400);
  }

  const eventId = request.headers.get('webhook-id')
    ?? request.headers.get('svix-id');
  if (!eventId || !/^[A-Za-z0-9_-]{5,200}$/.test(eventId)) {
    return privateText('Webhook identifier is missing or invalid.', 400);
  }

  try {
    await processClerkWebhookEvent({
      eventId,
      event,
      rawPayload,
      occurredAt: webhookOccurredAt(rawPayload),
    });
  } catch (error) {
    console.error('Clerk webhook processing failed.', {
      eventId,
      eventType: event.type,
      code: error instanceof Error ? error.message.slice(0, 120) : 'unknown_error',
    });
    return privateText('Webhook processing failed.', 500);
  }

  return Response.json({ received: true }, { status: 200, headers: PRIVATE_HEADERS });
}
