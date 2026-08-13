import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  platformQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: mocks.dbQuery }),
  platformDb: () => ({ query: mocks.platformQuery }),
}));

import {
  claimOutboxMessages,
  enqueueOutboxMessage,
  finishOutboxMessage,
} from '@/lib/transactional-outbox';

beforeEach(() => {
  mocks.dbQuery.mockReset();
  mocks.platformQuery.mockReset();
});

describe('enqueueOutboxMessage', () => {
  it('inserts a pending row in tenant context with a JSON payload', async () => {
    mocks.dbQuery.mockResolvedValue([]);
    await enqueueOutboxMessage('estimate_delivery', 'idem-1', { displayId: 'EST-0001' });

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.dbQuery.mock.calls[0] as [string, unknown[]];
    const [topic, key, payload] = params as [string, string, string];
    expect(sql).toContain('INSERT INTO transactional_outbox');
    expect(sql).toContain('app_require_organization_id()');
    expect(topic).toBe('estimate_delivery');
    expect(key).toBe('idem-1');
    expect(JSON.parse(payload)).toEqual({ displayId: 'EST-0001' });
  });
});

describe('claimOutboxMessages', () => {
  it('claims a batch through the SECURITY DEFINER window and maps columns', async () => {
    mocks.platformQuery.mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
      topic: 'estimate_delivery',
      key: 'idem-1',
      payload: { displayId: 'EST-0001' },
      attempts: 2,
    }]);

    const messages = await claimOutboxMessages(20);

    expect(mocks.platformQuery).toHaveBeenCalledWith(
      'SELECT * FROM claim_ready_outbox_messages($1)',
      [20],
    );
    expect(messages).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      topic: 'estimate_delivery',
      key: 'idem-1',
      payload: { displayId: 'EST-0001' },
      attempts: 2,
    }]);
  });

  it('returns no messages when the queue is empty', async () => {
    mocks.platformQuery.mockResolvedValue([]);
    expect(await claimOutboxMessages(5)).toEqual([]);
  });
});

describe('finishOutboxMessage', () => {
  it('records success through the finish window', async () => {
    mocks.platformQuery.mockResolvedValue([]);
    await finishOutboxMessage('id-1', true, null);
    expect(mocks.platformQuery).toHaveBeenCalledWith(
      'SELECT finish_outbox_message($1, $2, $3)',
      ['id-1', true, null],
    );
  });

  it('records a failure with the error code', async () => {
    mocks.platformQuery.mockResolvedValue([]);
    await finishOutboxMessage('id-1', false, 'provider_rate_limit');
    expect(mocks.platformQuery).toHaveBeenCalledWith(
      'SELECT finish_outbox_message($1, $2, $3)',
      ['id-1', false, 'provider_rate_limit'],
    );
  });
});
