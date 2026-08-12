import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEstimateDeliveryEmail,
  dispatchOutboxMessage,
  OutboxDispatchError,
  type EstimateDeliveryPayload,
} from '@/lib/outbox-dispatch';
import type { OutboxMessage } from '@/lib/transactional-outbox';

const VALID_PAYLOAD: EstimateDeliveryPayload = {
  displayId: 'EST-0001',
  customerEmail: 'customer@example.com',
  from: 'Paris Electric <hello@paris.usejbox.com>',
  companyName: 'Paris Electric',
  timeZone: 'America/New_York',
  expiresAt: '2026-09-01T00:00:00.000Z',
  viewUrl: 'https://paris.usejbox.com/documents/estimates/aaa',
  approveUrl: 'https://paris.usejbox.com/documents/estimates/bbb',
  declineUrl: 'https://paris.usejbox.com/documents/estimates/ccc',
};

function message(payload: unknown, key = 'idem-1'): OutboxMessage {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    topic: 'estimate_delivery',
    key,
    payload: payload as Record<string, unknown>,
    attempts: 1,
  };
}

function okFetch() {
  return async () => (new Response(JSON.stringify({ id: 'resend-message-id' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }) as Response);
}

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe('buildEstimateDeliveryEmail', () => {
  it('builds subject, text, and html with the document links', () => {
    const email = buildEstimateDeliveryEmail({
      companyName: 'Paris Electric',
      displayId: 'EST-0001',
      expiresAt: '2026-09-01T00:00:00.000Z',
      timeZone: 'America/New_York',
      viewUrl: 'https://paris.usejbox.com/view',
      approveUrl: 'https://paris.usejbox.com/approve',
      declineUrl: 'https://paris.usejbox.com/decline',
    });
    expect(email.subject).toBe('EST-0001 from Paris Electric');
    expect(email.text).toContain('https://paris.usejbox.com/view');
    expect(email.text).toContain('https://paris.usejbox.com/approve');
    expect(email.text).toContain('https://paris.usejbox.com/decline');
    expect(email.html).toContain('Review estimate');
    expect(email.html).toContain('Approve this estimate');
    expect(email.html).toContain('Decline this estimate');
  });

  it('escapes company and display id content in html', () => {
    const email = buildEstimateDeliveryEmail({
      companyName: '<script>alert(1)</script>',
      displayId: 'EST & 1',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      timeZone: 'UTC',
      viewUrl: 'https://paris.usejbox.com/v',
      approveUrl: 'https://paris.usejbox.com/a',
      declineUrl: 'https://paris.usejbox.com/d',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('EST &amp; 1');
  });
});

describe('dispatchOutboxMessage', () => {
  it('sends an estimate delivery email through the provider', async () => {
    process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
    let sentBody: Record<string, unknown> | null = null;
    let idempotencyKey: string | null = null;
    const fetchImplementation = (async (_url: string, init?: RequestInit) => {
      idempotencyKey = (init?.headers as Record<string, string>)['Idempotency-Key'];
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'resend-message-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await dispatchOutboxMessage(message(VALID_PAYLOAD, 'idem-42'), fetchImplementation);

    expect(sentBody).toMatchObject({
      from: 'Paris Electric <hello@paris.usejbox.com>',
      to: ['customer@example.com'],
      subject: 'EST-0001 from Paris Electric',
    });
    expect(sentBody?.text).toContain('https://paris.usejbox.com/documents/estimates/aaa');
    expect(idempotencyKey).toBe('idem-42');
  });

  it('rejects an unknown topic without sending', async () => {
    const fetchImplementation = okFetch();
    const unknown = { ...message(VALID_PAYLOAD), topic: 'invoice_delivery' };
    await expect(dispatchOutboxMessage(unknown, fetchImplementation))
      .rejects.toMatchObject({ code: 'unknown_topic', retryable: false });
  });

  it('rejects a malformed payload without sending', async () => {
    process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
    const malformed = message({ displayId: 'EST-0001' });
    await expect(dispatchOutboxMessage(malformed, okFetch()))
      .rejects.toMatchObject({ code: 'invalid_payload', retryable: false });
  });

  it('maps provider 4xx/5xx into a non-retryable/retryable error', async () => {
    process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
    const fetchImplementation = async () => new Response('rate limited', {
      status: 429,
    }) as Response;
    await expect(dispatchOutboxMessage(message(VALID_PAYLOAD), fetchImplementation))
      .rejects.toMatchObject({ code: 'provider_rate_limit', retryable: true });
  });

  it('fails closed when Resend is not configured', async () => {
    const error = await dispatchOutboxMessage(message(VALID_PAYLOAD), okFetch())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OutboxDispatchError);
    expect((error as OutboxDispatchError).code).toBe('delivery_not_configured');
  });
});
