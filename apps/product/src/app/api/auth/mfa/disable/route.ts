import type { NextRequest } from 'next/server';
import {
  readFieldSessionToken,
  verifyPassword,
  revokeAllSessionsForStaff,
} from '@/lib/auth';
import { resolveJwtFieldPrincipal } from '@/lib/field-api-auth';
import { verifyTotpToken } from '@/lib/mfa';
import { platformDb } from '@/lib/db';
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

  // Re-read the user's password hash and current totp_secret.
  const rows = (await platformDb().query(
    `SELECT pu.password_hash, pu.totp_secret, om.mfa_required
       FROM platform_users pu
       JOIN organization_memberships om
         ON om.platform_user_id = pu.id
          AND om.organization_id = $2
      WHERE pu.id = $1
        AND pu.status = 'active'
        AND om.status = 'active'`,
    [principal.actorId, principal.organizationId],
  )) as Array<{ password_hash: string | null; totp_secret: string | null; mfa_required: boolean }>;

  const user = rows[0];
  if (!user || !user.password_hash) {
    return privateJson({ error: 'invalid-credentials' }, 401);
  }

  if (!(await verifyPassword(body.password, user.password_hash))) {
    return privateJson({ error: 'invalid-credentials' }, 401);
  }

  if (user.mfa_required) {
    if (!user.totp_secret || !verifyTotpToken(body.totpToken, user.totp_secret)) {
      return privateJson({ error: 'invalid-totp' }, 401);
    }
  }

  // Clear TOTP secret and disable MFA requirement on the membership.
  await platformDb().query(
    `UPDATE platform_users SET totp_secret = NULL, updated_at = now() WHERE id = $1`,
    [principal.actorId],
  );
  await platformDb().query(
    `UPDATE organization_memberships
        SET mfa_required = false, updated_at = now()
      WHERE platform_user_id = $1 AND organization_id = $2`,
    [principal.actorId, principal.organizationId],
  );

  // Revoke all sessions — the principal must re-login with the new posture.
  await revokeAllSessionsForStaff(principal.actorId as string);

  return privateJson({ ok: true, message: 'MFA has been disabled. Please sign in again.' }, 200);
}
