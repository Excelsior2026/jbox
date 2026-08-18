import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getEstimate: vi.fn(),
  getJob: vi.fn(),
  loadInForceConfig: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ((strings: TemplateStringsArray, ...params: unknown[]) => {
    const text = strings.reduce(
      (acc, part, index) => acc + part + (index < params.length ? `$${index + 1}` : ''),
      '',
    );
    return mocks.dbQuery(text, params);
  }),
}));

vi.mock('@/lib/estimates', () => ({
  getEstimate: mocks.getEstimate,
}));

vi.mock('@/lib/jobs', () => ({
  getJob: mocks.getJob,
}));

vi.mock('@/lib/tenant', () => ({
  loadInForceConfig: mocks.loadInForceConfig,
}));

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => ({
    organizationId: '11111111-1111-1111-1111-111111111111',
    actorId: '22222222-2222-2222-2222-222222222222',
    requestId: '33333333-3333-3333-3333-333333333333',
  }),
}));

import { createJobForEstimate, linkEstimateToJob } from '@/lib/estimate-jobs';

describe('estimate-jobs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('generates correct SQL with app_require_organization_id() when linking existing job', async () => {
    const estimateId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const jobId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const customerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    // Mock initial check query
    mocks.dbQuery.mockResolvedValueOnce([
      {
        id: estimateId,
        customer_id: customerId,
        service_request_id: null,
        status: 'draft',
        updated_at_token: '2026-08-17T00:00:00.000Z',
        linked_job_id: null,
        linked_id: jobId,
        linked_customer_id: customerId,
        linked_service_request_id: null,
        linked_status: 'scheduled',
      },
    ]);

    // Mock update CTE
    mocks.dbQuery.mockResolvedValueOnce([{ id: jobId }]);

    mocks.getEstimate.mockResolvedValue({ id: estimateId, jobId });
    mocks.getJob.mockResolvedValue({ id: jobId, estimateId });

    const result = await linkEstimateToJob(
      estimateId,
      jobId,
      '2026-08-17T00:00:00.000Z',
      { ip: '127.0.0.1', userAgent: 'test-agent' },
    );

    expect(result.ok).toBe(true);
    expect(mocks.dbQuery).toHaveBeenCalledTimes(2);

    const updateQueryText = mocks.dbQuery.mock.calls[1][0] as string;
    expect(updateQueryText).toContain('INSERT INTO job_events (organization_id, job_id, event, actor_id, meta)');
    expect(updateQueryText).toContain('SELECT app_require_organization_id(), id, \'estimate_linked\', $');
  });

  it('handles createJobForEstimate and queries config prefix', async () => {
    const estimateId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const newJobId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

    mocks.getEstimate.mockResolvedValueOnce({
      id: estimateId,
      jobId: null,
      status: 'draft',
      updatedAt: '2026-08-17T00:00:00.000Z',
    });

    mocks.loadInForceConfig.mockResolvedValue({
      documents: { prefixes: { job: 'JOB' } },
    });

    mocks.dbQuery.mockResolvedValueOnce([{ id: newJobId }]);
    mocks.getEstimate.mockResolvedValueOnce({ id: estimateId, jobId: newJobId });
    mocks.getJob.mockResolvedValueOnce({ id: newJobId, estimateId });

    const result = await createJobForEstimate(
      estimateId,
      { title: 'New Job Title', notes: 'Notes' },
      '2026-08-17T00:00:00.000Z',
      { ip: '127.0.0.1', userAgent: 'test-agent' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.job.id).toBe(newJobId);
    }
  });
});
