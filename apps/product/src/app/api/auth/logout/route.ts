import { NextRequest, NextResponse } from 'next/server';
import {
  FIELD_SESSION_COOKIE,
  fieldSessionCookieOptions,
  fieldSessionResponse,
  revokeFieldSession,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Field sign-out. Revokes the session row (so the jti dies server-side) and
 * clears the cookie. A browser form submission (Accept: text/html) gets a 303
 * redirect back to the sign-in page; a fetch caller gets JSON.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(FIELD_SESSION_COOKIE)?.value ?? null;
  if (token) await revokeFieldSession(token);
  if (request.headers.get('accept')?.includes('text/html')) {
    const response = new NextResponse(null, {
      status: 303,
      headers: { Location: '/field/login' },
    });
    response.cookies.set(FIELD_SESSION_COOKIE, '', { ...fieldSessionCookieOptions(), maxAge: 0 });
    return response;
  }
  return fieldSessionResponse({ ok: true }, null, 200);
}
