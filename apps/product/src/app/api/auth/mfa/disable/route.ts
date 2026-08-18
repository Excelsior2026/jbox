import type { NextRequest } from 'next/server';
import {
  disableMfa,
  readFieldSessionToken,
  verifyUserGlobalPassword,
} from '@/lib/auth';
import { resolveJwtFieldPrincipal } from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/disable
 *
 * Disables TOTP MFA for the authenticated user. Requires:
 *   - A valid field session (authenticated)
 *   - The user's current password (re-auth)
 *   - A valid TOTP code from the current authenticator (proves device access)
 *
 * On success: clears totp_secret, sets mfa_required = false, revokes all
 * sessions (forces re-login so the new posture takes effect immediately).
 *
 * This is the only server-side recovery path for a user who wants to disable
 * MFA. A user who has lost their device must use an admin-assisted reset via
 * the control plane.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`mfa-disable:${ip}`, { capacity: 5, refillPerMinute: 2 }))) {
    return privateJson({ error: 'too-many-requests' }, 429);
  }

  const token = await readFieldSessionToken();
  const principal = await resolveJwtFieldPrincipal();
  if (!principal || !token) {
    return privateJson({ error: 'unauthenticated' }, 401);
  }

  let body: { password?: unknown; totpToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'invalid-body' }, 400);
  }

  if (typeof body.password !== 'string' || typeof body.totpToken !== 'string') {
    return privateJson({ error: 'password and totpToken are required' }, 400);
  }

  // Re-read user's password hash safely via staff_user_credential_lookup
  const credentialCheck = await verifyUserGlobalPassword(principal.email ?? '', body.password);
  if (!credentialCheck.ok) {
    return privateJson({ error: 'invalid-credentials' }, 401);
  }

  const result = await disableMfa(
    principal.actorId as string,
    principal.organizationId,
    body.totpToken.trim(),
  );

  if (!result.ok) {
    return privateJson({ error: result.reason ?? 'invalid-totp' }, 400);
  }

  return privateJson({ ok: true, message: 'MFA has been disabled. Please sign in again.' }, 200);
}
