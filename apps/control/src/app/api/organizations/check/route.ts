import { controlIsAuthorized } from '@/lib/control-auth';
import { checkSlugAvailability } from '@/lib/control-plane';

export const dynamic = 'force-dynamic';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function unauthorized() {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

/**
 * GET /api/organizations/check?slug=xxx — pre-flight slug availability check.
 * Returns { ok: true, available: true/false } so the onboarding wizard can
 * detect conflicts before the user submits the full provisioning request.
 */
export async function GET(request: Request) {
  if (!controlIsAuthorized(request.headers.get('authorization'))) return unauthorized();

  const slug = request.nextUrl.searchParams.get('slug') ?? '';
  if (!slug || !SLUG_PATTERN.test(slug) || slug.length > 63) {
    return Response.json(
      { ok: false, error: 'slug must be a valid subdomain (lowercase alphanumeric and hyphens, max 63 characters)' },
      { status: 400 },
    );
  }

  try {
    const result = await checkSlugAvailability(slug);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'unknown error' },
      { status: 500 },
    );
  }
}
