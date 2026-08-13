import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigV1 } from '@contractor-platform/configuration';
import type { EstimateRecord } from '@/lib/estimates';

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(),
  getEstimate: vi.fn(),
  loadInForceConfig: vi.fn(),
  customerAccessTokensConfigured: vi.fn(),
  issueCustomerAccessGrant: vi.fn(),
  enqueueOutboxMessage: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => mocks.requireOrganizationContext(),
}));
vi.mock('@/lib/estimates', () => ({
  getEstimate: (...args: unknown[]) => mocks.getEstimate(...args),
}));
vi.mock('@/lib/tenant', () => ({
  loadInForceConfig: (...args: unknown[]) => mocks.loadInForceConfig(...args),
}));
vi.mock('@/lib/customer-access-tokens', () => ({
  customerAccessTokensConfigured: () => mocks.customerAccessTokensConfigured(),
}));
vi.mock('@/lib/customer-access-grants', () => ({
  issueCustomerAccessGrant: (...args: unknown[]) => mocks.issueCustomerAccessGrant(...args),
}));
vi.mock('@/lib/transactional-outbox', () => ({
  enqueueOutboxMessage: (...args: unknown[]) => mocks.enqueueOutboxMessage(...args),
}));
vi.mock('@/lib/db', () => ({
  db: () => ({ query: mocks.dbQuery }),
}));

import { createEstimateDelivery } from '@/lib/estimate-delivery';

const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';

const ESTIMATE = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'EST-0001',
  customerId: '33333333-3333-4333-8333-333333333333',
  status: 'draft',
  title: 'Drain & sewer line',
  customer: {
    email: 'customer@example.com',
    name: 'Patricia O\u2019Neill',
    phone: '',
    address: '',
    town: '',
    project: '',
  },
  lineItems: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} as unknown as EstimateRecord;

const CONFIG = {
  version: 'v1',
  identity: { businessName: 'Paris Electric', tagline: '' },
  contact: { phone: '', email: 'hello@paris.usejbox.com', address: '', hours: '' },
} as unknown as ConfigV1;

const CONTEXT = { organizationId: ORGANIZATION_ID, actorId: 'actor-1', requestId: 'req-1' };

function granted(token: string, id = 'grant-id') {
  return {
    grant: { id, customerId: ESTIMATE.customerId, documentType: 'estimate', documentId: ESTIMATE.id, purpose: 'sign', expiresAt: '2026-08-15T00:00:00.000Z' },
    token,
  };
}

beforeEach(() => {
  mocks.requireOrganizationContext.mockReturnValue(CONTEXT);
  mocks.getEstimate.mockResolvedValue(ESTIMATE);
  mocks.loadInForceConfig.mockResolvedValue(CONFIG);
  mocks.customerAccessTokensConfigured.mockReturnValue(true);
  mocks.issueCustomerAccessGrant.mockResolvedValue(granted('token-view'));
  mocks.enqueueOutboxMessage.mockResolvedValue(undefined);
  mocks.dbQuery.mockResolvedValue([{ hostname: 'paris.usejbox.com' }]);
  process.env.RESEND_API_KEY = 're_test_abcdefghijkl';
});

describe('createEstimateDelivery gating', () => {
  it('returns estimate-not-found when the estimate is missing', async () => {
    mocks.getEstimate.mockResolvedValue(null);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('estimate-not-found');
  });

  it('returns estimate-not-draft unless the estimate is a draft', async () => {
    mocks.getEstimate.mockResolvedValue({ ...ESTIMATE, status: 'signed' } as EstimateRecord);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('estimate-not-draft');
  });

  it('returns customer-email-missing without a usable recipient', async () => {
    mocks.getEstimate.mockResolvedValue({
      ...ESTIMATE,
      customer: { ...ESTIMATE.customer, email: '' },
    } as EstimateRecord);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('customer-email-missing');
  });

  it('returns delivery-not-configured when the tenant has no config', async () => {
    mocks.loadInForceConfig.mockResolvedValue(null);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('delivery-not-configured');
  });

  it('returns delivery-not-configured when Resend is not usable', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('delivery-not-configured');
    expect(mocks.enqueueOutboxMessage).not.toHaveBeenCalled();
  });

  it('returns link-tokens-not-configured when access tokens are unset', async () => {
    mocks.customerAccessTokensConfigured.mockReturnValue(false);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('link-tokens-not-configured');
  });

  it('returns tenant-host-not-found without a verified canonical domain', async () => {
    mocks.dbQuery.mockResolvedValue([]);
    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('tenant-host-not-found');
  });
});

describe('createEstimateDelivery enqueue', () => {
  it('issues view and sign grants and enqueues a self-contained payload', async () => {
    mocks.issueCustomerAccessGrant
      .mockResolvedValueOnce(granted('token-view'))
      .mockResolvedValueOnce(granted('token-sign'));

    const result = await createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' });

    expect(result.ok).toBe(true);
    expect(mocks.issueCustomerAccessGrant).toHaveBeenCalledTimes(2);
    const [viewCall, signCall] = mocks.issueCustomerAccessGrant.mock.calls as [Record<string, unknown>[], Record<string, unknown>[]];
    expect(viewCall[0].purpose).toBe('estimate.view');
    expect(signCall[0].purpose).toBe('estimate.sign');
    expect(viewCall[0].createdBy).toBe('actor-1');

    expect(mocks.enqueueOutboxMessage).toHaveBeenCalledTimes(1);
    const [topic, key, payload] = mocks.enqueueOutboxMessage.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(topic).toBe('estimate_delivery');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload).toMatchObject({
      displayId: 'EST-0001',
      customerEmail: 'customer@example.com',
      from: 'hello@paris.usejbox.com',
      replyTo: 'hello@paris.usejbox.com',
      companyName: 'Paris Electric',
      viewUrl: 'https://paris.usejbox.com/estimates/token-view',
      approveUrl: 'https://paris.usejbox.com/estimates/token-sign?intent=approve',
      declineUrl: 'https://paris.usejbox.com/estimates/token-sign?intent=decline',
    });
    expect(typeof payload.expiresAt).toBe('string');

    if (result.ok) {
      expect(result.delivery.status).toBe('queued');
    }
  });

  it('revokes both grants and rethrows when enqueueing fails', async () => {
    mocks.enqueueOutboxMessage.mockRejectedValue(new Error('queue down'));

    await expect(createEstimateDelivery({ estimateId: ESTIMATE.id, timeZone: 'UTC' }))
      .rejects.toThrow('queue down');

    const revocations = mocks.dbQuery.mock.calls.filter(
      (call) => String(call[0]).includes('status = \'revoked\''),
    );
    expect(revocations.length).toBe(2);
  });
});
