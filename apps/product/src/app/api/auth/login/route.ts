import {
  fieldSessionResponse,
  listActiveMembershipsForEmail,
  loginWithPassword,
  verifyUserGlobalPassword,
} from '@/lib/auth';
import { privateJson } from '@/lib/http';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Field sign-in. Authenticates email + password and sets the HttpOnly session
 * cookie. The organization is optional:
 *
 *   - named in the body, or
 *   - resolved from a verified tenant hostname, or
 *   - the caller's only active membership.
 *
 * When an email has several organizations and none was named, the password is
 * verified first, and only upon valid credentials does the route return 400
 * with the choices. All invalid credentials collapse to 401 so the endpoint
 * cannot be used to enumerate accounts or tenant memberships (SEC-09).
 *
 * If MFA is required, returns 401 with { error: 'mfa-required' }.
 * Client should then POST to this same endpoint with totpToken.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`login:${ip}`, { capacity: 10, refillPerMinute: 10 }))) {
    return privateJson({ error: 'too-many-requests' }, 429);
  }

  let body: { email?: unknown; password?: unknown; organizationId?: unknown; totpToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'invalid-body' }, 400);
  }
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return privateJson({ error: 'invalid-body' }, 400);
  }
  const email = body.email.trim().toLowerCase();
  if (!email || !body.password) {
    return privateJson({ error: 'invalid-credentials' }, 401);
  }

  const namedOrganization = typeof body.organizationId === 'string'
    && UUID_PATTERN.test(body.organizationId.trim())
    ? body.organizationId.trim()
    : null;

  let organizationId: string | null = namedOrganization;
  let organizations: Array<{ organizationId: string; role: string }> | null = null;

  if (!organizationId) {
    // Verify password globally before returning multi-tenant organization choices (SEC-09)
    const validPassword = await verifyUserGlobalPassword(email, body.password);
    if (!validPassword.ok) {
      return privateJson({ error: 'invalid-credentials' }, 401);
    }

    const memberships = await listActiveMembershipsForEmail(email);
    if (memberships.length === 1) {
      organizationId = memberships[0].organizationId;
    } else if (memberships.length > 1) {
      organizations = memberships.map((m) => ({
        organizationId: m.organizationId,
        role: m.role,
      }));
    }
  }

  if (!organizationId) {
    return privateJson(
      organizations
        ? { error: 'organization-required', organizations }
        : { error: 'invalid-credentials' },
      organizations ? 400 : 401,
    );
  }

  const totpToken = typeof body.totpToken === 'string' ? body.totpToken.trim() : undefined;

  const result = await loginWithPassword({ email, password: body.password, organizationId, totpToken });
  if (!result.ok) {
    if (result.reason === 'mfa-required') {
      return privateJson({ error: 'mfa-required' }, 401);
    }
    return privateJson({ error: result.reason }, 401);
  }

  return fieldSessionResponse(
    { ok: true, expiresAt: result.value.expiresAt },
    result.value.token,
    200,
  );
}
