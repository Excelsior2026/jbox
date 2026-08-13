import type { NextRequest } from 'next/server';
import { OnboardingError, draftStorefrontFor, validateDraftInput } from '@/lib/onboarding';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/onboarding/draft — drafts storefront copy from a few
 * business facts. Live model when NVIDIA_API_KEY is set, template draft
 * otherwise; the response always carries a usable draft plus its source.
 * Rate-limited per IP because every call is a paid model inference.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!rateLimit(`onboarding:draft:${ip}`, { capacity: 20, refillPerMinute: 10 })) {
    return Response.json({ ok: false, error: 'Too many requests. Try again in a minute.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'request body must be JSON' }, { status: 400 });
  }

  try {
    const input = validateDraftInput(body);
    const { draft, source } = await draftStorefrontFor(input);
    return Response.json({ ok: true, source, draft }, { status: 200 });
  } catch (error) {
    if (error instanceof OnboardingError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'could not draft storefront copy' }, { status: 500 });
  }
}
