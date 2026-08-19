import { controlIsAuthorized } from '@/lib/control-auth';
import {
  generateDomainChallenge,
  removeCustomDomain,
  verifyCustomDomain,
} from '@/lib/control-plane';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

function badRequest(message: string) {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/**
 * DELETE /api/organizations/[id]/domains/[domainId] — remove a custom domain.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; domainId: string }> },
) {
  if (!controlIsAuthorized(request.headers.get('authorization'))) return unauthorized();

  const { id, domainId } = await context.params;
  if (!UUID_PATTERN.test(id)) return badRequest('organization id must be a uuid');
  if (!UUID_PATTERN.test(domainId)) return badRequest('domain id must be a uuid');

  try {
    await removeCustomDomain(id, domainId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message.includes('not found') ? 404 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}

/**
 * POST /api/organizations/[id]/domains/[domainId] — lifecycle actions on a domain.
 *   { "action": "verify" }  — verify domain ownership via DNS TXT record
 *   { "action": "challenge" } — get DNS TXT record challenge for verification
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; domainId: string }> },
) {
  if (!controlIsAuthorized(request.headers.get('authorization'))) return unauthorized();

  const { id, domainId } = await context.params;
  if (!UUID_PATTERN.test(id)) return badRequest('organization id must be a uuid');
  if (!UUID_PATTERN.test(domainId)) return badRequest('domain id must be a uuid');

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('request body must be JSON');
  }

  if (body.action !== 'verify' && body.action !== 'challenge') {
    return badRequest('action must be "verify" or "challenge"');
  }

  try {
    if (body.action === 'verify') {
      await verifyCustomDomain(id, domainId);
      return Response.json({ ok: true, action: 'verify', verified: true });
    } else {
      const challenge = await generateDomainChallenge(id, domainId);
      return Response.json({ ok: true, action: 'challenge', challenge });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
