import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Authorization for outbound-platform cron endpoints. These routes perform
 * cross-tenant work (the outbox drain) with no authenticated user, so access is
 * granted by a shared secret sent as `Authorization: Bearer <CRON_SECRET>`.
 *
 * The comparison is timing-safe and hashes both sides first so a length
 * mismatch cannot leak the secret's length either.
 */
export function cronIsConfigured() {
  return Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32);
}

export function cronIsAuthorized(authorizationHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;

  const supplied = createHash('sha256')
    .update(authorizationHeader ?? '')
    .digest();
  const expected = createHash('sha256')
    .update(`Bearer ${secret}`)
    .digest();
  return timingSafeEqual(supplied, expected);
}
