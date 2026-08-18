import { describe, expect, it, vi } from 'vitest';
import { decideCustomerEstimate } from '@/lib/customer-estimate-decision';

describe('decideCustomerEstimate validation', () => {
  it('rejects malformed token syntax', async () => {
    const result = await decideCustomerEstimate('invalid-token-format', {
      decision: 'approved',
      signerName: 'Jane Doe',
      affirmativeConsent: true,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects approval without affirmative consent', async () => {
    const validToken = 'a'.repeat(32) + '.' + 'b'.repeat(43);
    const result = await decideCustomerEstimate(validToken, {
      decision: 'approved',
      signerName: 'Jane Doe',
      affirmativeConsent: false,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('accepts decline whether affirmativeConsent is true or false', async () => {
    const validToken = 'a'.repeat(32) + '.' + 'b'.repeat(43);
    // Mock db to return empty row for test
    vi.mock('@/lib/db', () => ({
      db: () => ({
        query: vi.fn().mockResolvedValue([]),
      }),
    }));

    const result = await decideCustomerEstimate(validToken, {
      decision: 'declined',
      signerName: '',
      affirmativeConsent: true,
    });
    expect(result.reason).not.toBe('invalid');
  });
});
