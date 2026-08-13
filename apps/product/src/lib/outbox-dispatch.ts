import 'server-only';

import type { OutboxMessage } from '@/lib/transactional-outbox';
import {
  claimOutboxMessages,
  finishOutboxMessage,
} from '@/lib/transactional-outbox';

const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_DISPATCH_BATCH = 50;

/**
 * Single source of truth for "is the email provider actually usable?". The
 * enqueue gate (estimate-delivery) and the dispatch path (sendEstimateDeliveryEmail)
 * must agree on this, or deliveries would queue that the drain could never
 * send.
 */
export function isResendConfigured(): boolean {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  return apiKey.startsWith('re_') && apiKey.length >= 12;
}

export type OutboxDispatchSummary = {
  claimed: number;
  delivered: number;
  failed: number;
};

export class OutboxDispatchError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'OutboxDispatchError';
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function documentDate(value: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone,
  }).format(new Date(value));
}

export type EstimateDeliveryPayload = {
  displayId: string;
  customerEmail: string;
  from: string;
  replyTo?: string;
  companyName: string;
  timeZone: string;
  expiresAt: string;
  viewUrl: string;
  approveUrl: string;
  declineUrl: string;
};

function isEstimateDeliveryPayload(value: unknown): value is EstimateDeliveryPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const strings: Array<keyof EstimateDeliveryPayload> = [
    'displayId', 'customerEmail', 'from', 'companyName', 'timeZone',
    'expiresAt', 'viewUrl', 'approveUrl', 'declineUrl',
  ];
  for (const field of strings) {
    if (typeof v[field] !== 'string' || (v[field] as string).length === 0) return false;
  }
  if (v.replyTo !== undefined && typeof v.replyTo !== 'string') return false;
  if (typeof v.expiresAt !== 'string' || new Date(v.expiresAt).getTime() <= 0) return false;
  for (const url of [v.viewUrl, v.approveUrl, v.declineUrl]) {
    try {
      const parsed = new URL(url as string);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function buildEstimateDeliveryEmail(options: {
  companyName: string;
  displayId: string;
  expiresAt: Date | string;
  timeZone: string;
  viewUrl: string;
  approveUrl: string;
  declineUrl: string;
}) {
  const expiry = documentDate(options.expiresAt, options.timeZone);
  const subject = `${options.displayId} from ${options.companyName}`;
  const text = [
    `${options.companyName} sent you estimate ${options.displayId}.`,
    '',
    `Review or download the estimate: ${options.viewUrl}`,
    '',
    `Approve this exact estimate: ${options.approveUrl}`,
    `Decline this exact estimate: ${options.declineUrl}`,
    '',
    `These private links expire on ${expiry}. If you did not expect this estimate, contact ${options.companyName} directly.`,
  ].join('\n');
  const html = `
    <div style="background:#f3f1eb;padding:32px 16px;font-family:Arial,sans-serif;color:#17242d">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-top:4px solid #dda052;padding:28px">
        <p style="margin:0 0 8px;color:#986224;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(options.companyName)} · Private document</p>
        <h1 style="margin:0 0 10px;color:#081726;font-size:25px;line-height:1.2">Your estimate is ready</h1>
        <p style="margin:0 0 24px;color:#65717a;font-size:14px;line-height:1.6">${escapeHtml(options.displayId)} is available for review through ${escapeHtml(expiry)}.</p>
        <p style="margin:0 0 24px">
          <a href="${escapeHtml(options.viewUrl)}" style="display:inline-block;background:#081726;color:#fff;padding:13px 19px;text-decoration:none;font-size:13px;font-weight:700">Review estimate</a>
        </p>
        <table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #e3e7ea">
          <tr>
            <td style="padding:18px 8px 0 0"><a href="${escapeHtml(options.approveUrl)}" style="color:#126141;font-size:13px;font-weight:700">Approve this estimate</a></td>
            <td style="padding:18px 0 0 8px;text-align:right"><a href="${escapeHtml(options.declineUrl)}" style="color:#8a3434;font-size:13px;font-weight:700">Decline this estimate</a></td>
          </tr>
        </table>
        <p style="margin:24px 0 0;color:#65717a;font-size:11px;line-height:1.55">Each action is bound to this exact estimate. If you did not expect this estimate, contact ${escapeHtml(options.companyName)} directly.</p>
      </div>
    </div>
  `.trim();
  return { subject, text, html };
}

async function sendEstimateDeliveryEmail(
  payload: EstimateDeliveryPayload,
  idempotencyKey: string,
  fetchImplementation: typeof fetch,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  if (!isResendConfigured()) {
    throw new OutboxDispatchError('delivery_not_configured', false);
  }

  const email = buildEstimateDeliveryEmail({
    companyName: payload.companyName,
    displayId: payload.displayId,
    expiresAt: payload.expiresAt,
    timeZone: payload.timeZone,
    viewUrl: payload.viewUrl,
    approveUrl: payload.approveUrl,
    declineUrl: payload.declineUrl,
  });

  let response: Response;
  try {
    response = await fetchImplementation(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        'User-Agent': 'contractor-platform/0.2.0',
      },
      body: JSON.stringify({
        from: payload.from,
        to: [payload.customerEmail],
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OutboxDispatchError('provider_network', true);
  }

  if (!response.ok) {
    throw providerError(response.status);
  }

  try {
    const body = await response.json() as { id?: unknown };
    if (typeof body.id !== 'string' || body.id.length < 1 || body.id.length > 200) {
      throw new Error('Invalid provider response.');
    }
  } catch {
    throw new OutboxDispatchError('provider_invalid_response', true);
  }
}

function providerError(status: number) {
  if (status === 429) return new OutboxDispatchError('provider_rate_limit', true);
  if (status >= 500) return new OutboxDispatchError('provider_unavailable', true);
  if (status === 401 || status === 403) {
    return new OutboxDispatchError('provider_auth', false);
  }
  if (status === 409) {
    return new OutboxDispatchError('provider_idempotency_conflict', false);
  }
  return new OutboxDispatchError('provider_rejected', false);
}

/**
 * Dispatches a single claimed outbox message. The payload is self-contained so
 * the handler needs no tenant context: the producer (the estimate delivery
 * route) put the recipient, the document links, and the sender config in the
 * payload at enqueue time.
 */
export async function dispatchOutboxMessage(
  message: OutboxMessage,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  if (message.topic !== 'estimate_delivery') {
    throw new OutboxDispatchError('unknown_topic', false);
  }
  if (!isEstimateDeliveryPayload(message.payload)) {
    throw new OutboxDispatchError('invalid_payload', false);
  }
  await sendEstimateDeliveryEmail(message.payload, message.key, fetchImplementation);
}

/**
 * Claims and dispatches the next batch of outbox messages, then records the
 * outcome through the SECURITY DEFINER finish window. Runs on the platform
 * client end to end: claiming and finishing are the cross-tenant windows and
 * the delivery itself needs no tenant.
 *
 * The claimed/failed accounting is deliberately coarse. Whether a failure
 * retries or goes dead is decided inside finish_outbox_message (attempts vs the
 * 12-attempt ceiling); the cron only reports the counts it can know.
 */
export async function dispatchOutboxMessages(options: {
  limit?: number;
  fetchImplementation?: typeof fetch;
} = {}): Promise<OutboxDispatchSummary> {
  const limit = Math.min(
    MAX_DISPATCH_BATCH,
    Math.max(1, Math.trunc(options.limit ?? 20)),
  );
  const messages = await claimOutboxMessages(limit);
  const summary: OutboxDispatchSummary = {
    claimed: messages.length,
    delivered: 0,
    failed: 0,
  };
  const fetchImplementation = options.fetchImplementation ?? fetch;

  for (const message of messages) {
    try {
      await dispatchOutboxMessage(message, fetchImplementation);
    } catch (error) {
      const code = error instanceof OutboxDispatchError
        ? error.code
        : 'dispatch_error';
      try {
        await finishOutboxMessage(message.id, false, code);
      } catch {
        // The claim lease (5 minutes) will expire and the message becomes
        // eligible again; nothing further to do here.
      }
      summary.failed += 1;
      continue;
    }

    try {
      await finishOutboxMessage(message.id, true, null);
      summary.delivered += 1;
    } catch {
      // Lease expiry will re-claim; do not double-count.
    }
  }
  return summary;
}
