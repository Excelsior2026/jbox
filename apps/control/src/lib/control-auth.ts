import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { controlApiToken } from '@/lib/control-env';

/**
 * Authorization for control-plane endpoints. These routes perform
 * cross-tenant work with no authenticated operator, so access is granted by a
 * shared secret sent as `Authorization: Bearer <CONTROL_API_TOKEN>`.
 *
 * The comparison is timing-safe and hashes both sides first so a length
 * mismatch cannot leak the secret's length either.
 */
export function controlIsAuthorized(authorizationHeader: string | null): boolean {
  const token = controlApiToken();
  const supplied = createHash('sha256')
    .update(authorizationHeader ?? '')
    .digest();
  const expected = createHash('sha256')
    .update(`Bearer ${token}`)
    .digest();
  return timingSafeEqual(supplied, expected);
}
