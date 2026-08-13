import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/control-env', () => ({
  controlApiToken: () => 'a-very-secret-token-for-tests-000000',
}));

import { controlIsAuthorized } from '@/lib/control-auth';

describe('controlIsAuthorized', () => {
  it('accepts the correct bearer token', () => {
    expect(controlIsAuthorized('Bearer a-very-secret-token-for-tests-000000')).toBe(true);
  });

  it('rejects a wrong token', () => {
    expect(controlIsAuthorized('Bearer wrong')).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(controlIsAuthorized(null)).toBe(false);
  });
});
