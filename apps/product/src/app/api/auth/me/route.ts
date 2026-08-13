import type { NextRequest } from 'next/server';
import { FIELD_SESSION_COOKIE, resolveStaffFromToken } from '@/lib/auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Current session profile. The Field shell uses this to render the signed-in
 * staff member; a missing or revoked session reads as 401.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(FIELD_SESSION_COOKIE)?.value ?? null;
  if (!token) return privateJson({ error: 'unauthenticated' }, 401);

  const staff = await resolveStaffFromToken(token);
  if (!staff) return privateJson({ error: 'unauthenticated' }, 401);

  return privateJson({
    staff: {
      email: staff.email,
      displayName: staff.displayName,
      organizationId: staff.organizationId,
      membershipId: staff.membershipId,
      role: staff.role,
    },
  });
}
