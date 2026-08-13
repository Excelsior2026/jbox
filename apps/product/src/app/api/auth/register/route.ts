import type { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/auth';
import { platformDb } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { isApplicationRole } from '@/lib/identity';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Staff provisioning. Replaces the Clerk membership webhook: an operator calls
 * this with the provisioning secret to create (or re-activate) a staff member
 * and their membership. Nothing about the account shape is exposed here — the
 * endpoint is the narrow window into the identity tables, so it requires the
 * header and returns only an opaque 201.
 */
export async function POST(request: NextRequest) {
  const provisionSecret = process.env.FIELD_PROVISION_SECRET?.trim() ?? '';
  if (!provisionSecret) return privateJson({ error: 'not-configured' }, 503);
  if (request.headers.get('x-provision-token') !== provisionSecret) {
    return privateJson({ error: 'unauthorized' }, 401);
  }

  let body: {
    email?: unknown;
    password?: unknown;
    displayName?: unknown;
    organizationId?: unknown;
    role?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'invalid-body' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const organizationId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
  if (
    !email
    || !password
    || !organizationId
    || !UUID_PATTERN.test(organizationId)
    || !isApplicationRole(body.role)
  ) {
    return privateJson({ error: 'invalid-body' }, 400);
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch {
    return privateJson({ error: 'password-too-short' }, 400);
  }

  await platformDb().query(
    `SELECT provision_staff_member($1::text, $2::text, $3::text, $4::uuid, $5::text)`,
    [email, displayName, passwordHash, organizationId, body.role],
  );

  return privateJson({ ok: true }, 201);
}
