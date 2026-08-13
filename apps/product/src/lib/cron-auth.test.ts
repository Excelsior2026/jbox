import { afterEach, describe, expect, it } from 'vitest';
import { cronIsAuthorized, cronIsConfigured } from '@/lib/cron-auth';

const VALID_SECRET = 'a'.repeat(32);

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('cronIsConfigured', () => {
  it('is false when the secret is unset', () => {
    expect(cronIsConfigured()).toBe(false);
  });

  it('is false when the secret is shorter than 32 chars', () => {
    process.env.CRON_SECRET = 'short';
    expect(cronIsConfigured()).toBe(false);
  });

  it('is true for a 32+ char secret', () => {
    process.env.CRON_SECRET = VALID_SECRET;
    expect(cronIsConfigured()).toBe(true);
  });
});

describe('cronIsAuthorized', () => {
  it('rejects when the secret is unconfigured', () => {
    expect(cronIsAuthorized(`Bearer ${VALID_SECRET}`)).toBe(false);
  });

  it('rejects a missing header', () => {
    process.env.CRON_SECRET = VALID_SECRET;
    expect(cronIsAuthorized(null)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    process.env.CRON_SECRET = VALID_SECRET;
    expect(cronIsAuthorized(`Bearer ${'b'.repeat(32)}`)).toBe(false);
  });

  it('rejects a header without the Bearer scheme', () => {
    process.env.CRON_SECRET = VALID_SECRET;
    expect(cronIsAuthorized(VALID_SECRET)).toBe(false);
  });

  it('accepts the correct secret', () => {
    process.env.CRON_SECRET = VALID_SECRET;
    expect(cronIsAuthorized(`Bearer ${VALID_SECRET}`)).toBe(true);
  });

  it('does not throw on a header of different length (timing-safe)', () => {
    process.env.CRON_SECRET = VALID_SECRET;
    expect(cronIsAuthorized('Bearer short')).toBe(false);
  });
});
