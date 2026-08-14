import type { NextRequest } from 'next/server';
import { FIELD_SESSION_COOKIE, readFieldSessionToken, resolveStaffFromToken, completeMfaEnrollment } from '@/lib/auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Completes MFA enrollment by verifying the first TOTP code.
 * Requires the user to be authenticated and have a pending MFA enrollment.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(FIELD_SESSION_COOKIE)?.value ?? null;
  if (!token) return privateJson({ error: 'unauthenticated' }, 401);

  const staff = await resolveStaffFromToken(token);
  if (!staff) return privateJson({ error: 'unauthenticated' }, 401);

  let body: { totpToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'invalid-body' }, 400);
  }
  const totpToken = typeof body.totpToken === 'string' ? body.totpToken.trim() : '';
  if (!totpToken || totpToken.length !== 6 || !/^\d{6}$/.test(totpToken)) {
    return privateJson({ error: 'invalid-token' }, 400);
  }

  const result = await completeMfaEnrollment(staff.platformUserId, staff.organizationId, totpToken);
  if (!result.ok) {
    return privateJson({ error: result.reason }, 400);
  }

  return privateJson({ ok: true });
}