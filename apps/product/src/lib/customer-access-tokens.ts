import 'server-only';

import {
  createHash,
  createHmac,
} from 'node:crypto';
import type { CustomerAccessPurpose } from '@contractor-platform/domain';

export type CustomerAccessTokenScope = {
  grantId: string;
  organizationId: string;
  resourceInternalId: string;
  resourceVersionId: string;
  purpose: CustomerAccessPurpose;
  keyVersion: string;
};

function currentKeyVersion() {
  return process.env.CUSTOMER_LINK_KEY_VERSION?.trim() || 'v1';
}

function secretForKeyVersion(keyVersion: string) {
  if (keyVersion === currentKeyVersion()) {
    return process.env.CUSTOMER_LINK_SECRET?.trim() ?? '';
  }

  const previousKeys = process.env.CUSTOMER_LINK_PREVIOUS_KEYS_JSON;
  if (!previousKeys) return '';
  try {
    const parsed = JSON.parse(previousKeys) as Record<string, unknown>;
    return typeof parsed[keyVersion] === 'string'
      ? parsed[keyVersion].trim()
      : '';
  } catch {
    return '';
  }
}

export function customerAccessTokenKeyVersion() {
  return currentKeyVersion();
}

export function customerAccessTokensConfigured() {
  return Buffer.byteLength(secretForKeyVersion(currentKeyVersion()), 'utf8') >= 32;
}

function scopeBytes(scope: CustomerAccessTokenScope) {
  return [
    'contractor-platform-customer-access-v1',
    scope.keyVersion,
    scope.grantId,
    scope.organizationId,
    scope.resourceInternalId,
    scope.resourceVersionId,
    scope.purpose,
  ].join('\n');
}

export function deriveCustomerAccessToken(
  scope: CustomerAccessTokenScope,
  secret = secretForKeyVersion(scope.keyVersion),
) {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('customer_link_secret_is_not_configured');
  }
  return createHmac('sha256', secret)
    .update(scopeBytes(scope))
    .digest('base64url');
}

export function hashCustomerAccessToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function customerAccessTokenHasValidSyntax(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
