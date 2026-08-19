import { controlIsAuthorized } from '@/lib/control-auth';
import { addCustomDomain, listOrganizationDomains } from '@/lib/control-plane';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

function badRequest(message: string) {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/**
 * GET /api/organizations/[id]/domains — list all domains for an organization.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!controlIsAuthorized(request.headers.get('authorization'))) return unauthorized();

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return badRequest('organization id must be a uuid');

  try {
    const domains = await listOrganizationDomains(id);
    return Response.json({ ok: true, domains });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/organizations/[id]/domains — add a custom domain to an organization.
 * Body: { "hostname": "smithplumbing.com" }
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!controlIsAuthorized(request.headers.get('authorization'))) return unauthorized();

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return badRequest('organization id must be a uuid');

  let body: { hostname?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('request body must be JSON');
  }

  if (typeof body.hostname !== 'string' || !body.hostname.trim()) {
    return badRequest('hostname is required');
  }

  try {
    const domain = await addCustomDomain(id, body.hostname.trim().toLowerCase());
    return Response.json({ ok: true, domain }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message.includes('already in use') ? 409 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
