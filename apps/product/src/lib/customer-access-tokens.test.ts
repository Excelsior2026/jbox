import { describe, expect, it } from 'vitest';
import {
  customerAccessTokenHasValidSyntax,
  deriveCustomerAccessToken,
  hashCustomerAccessToken,
} from './customer-access-tokens';

const scope = {
  grantId: 'af825dcb-a780-466f-8fcb-f581408ac320',
  organizationId: '4332ed7c-8859-43cd-a47f-825b3e383c3d',
  resourceInternalId: '47baf36b-ed54-43c4-aa11-54782373fd73',
  resourceVersionId: '70ffca8f-b2a2-4c96-ad17-77e976ad35e2',
  purpose: 'estimate.sign' as const,
  keyVersion: 'v1',
};
const secret = 'test-only-customer-link-secret-with-32-bytes-minimum';

describe('customer access tokens', () => {
  it('derives a stable high-entropy token without storing the raw token', () => {
    const token = deriveCustomerAccessToken(scope, secret);
    expect(customerAccessTokenHasValidSyntax(token)).toBe(true);
    expect(token).toBe(deriveCustomerAccessToken(scope, secret));
    expect(hashCustomerAccessToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCustomerAccessToken(token)).not.toContain(scope.grantId);
  });

  it('binds the token to organization, resource, version, and purpose', () => {
    const token = deriveCustomerAccessToken(scope, secret);
    for (const changed of [
      { ...scope, organizationId: '1863bb5d-3ecc-4a68-a54c-39953dde18fa' },
      { ...scope, resourceInternalId: 'ac0664f4-7883-4f74-8444-9de284c252eb' },
      { ...scope, resourceVersionId: '1ebf1446-5418-40f4-b0f3-fe981b1471e5' },
      { ...scope, purpose: 'estimate.view' as const },
    ]) {
      expect(deriveCustomerAccessToken(changed, secret)).not.toBe(token);
    }
  });

  it('rejects weak keys and malformed bearer tokens', () => {
    expect(() => deriveCustomerAccessToken(scope, 'too-short')).toThrow(
      'customer_link_secret_is_not_configured',
    );
    expect(customerAccessTokenHasValidSyntax('not-a-token')).toBe(false);
  });
});
