import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { isDatabaseConfigured } from '@/lib/db';
import { validateEstimateDraftInput } from '@/lib/estimate-contract';
import { getEstimate, updateEstimate } from '@/lib/estimates';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN as ID_PATTERN } from '@/lib/ids';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 262144;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  const { id } = await params;
  if (!ID_PATTERN.test(id)) return privateJson({ error: 'Not found' }, 404);

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const estimate = await getEstimate(id);
      return estimate ? privateJson({ estimate }) : privateJson({ error: 'Not found' }, 404);
    });
  } catch (error) {
    console.error('Estimate read failed.', error);
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }

  const { id } = await params;
  if (!ID_PATTERN.test(id)) return privateJson({ error: 'Not found' }, 404);

  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return privateJson({ error: 'Bad Request' }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid body' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return privateJson({ error: 'Body must be an object.' }, 400);
  }

  // updateEstimate compares this against the stored updated_at. A missing token
  // could not match anything, so passing it through would yield a 409 the caller
  // can never clear by reloading — that is a malformed request, not a conflict.
  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt === '') {
    return privateJson({ error: 'expectedUpdatedAt is required.' }, 400);
  }

  const draft = validateEstimateDraftInput(body.draft);
  if (!draft.ok) return privateJson({ error: draft.error }, 400);

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const result = await updateEstimate(id, draft.value, expectedUpdatedAt, {
        ip: getClientIp(request).slice(0, 128),
        userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
      });

      if (result.ok) return privateJson({ estimate: result.value });
      if (result.reason === 'not-found') return privateJson({ error: 'Not found' }, 404);

      // Both are 409, but they demand opposite client behaviour, so the reason is
      // machine-readable: a conflict clears on reload, whereas a locked estimate is
      // terminal (signed or declined) and must be revised by duplicating it.
      const conflicted = result.reason === 'conflict';
      return privateJson({
        error: conflicted
          ? 'This estimate changed since you loaded it. Reload and reapply your edits.'
          : 'This estimate is signed or declined and can no longer be edited. Duplicate it to revise.',
        reason: result.reason,
        retryable: conflicted,
      }, 409);
    });
  } catch (error) {
    console.error('Estimate update failed.', error);
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }
}
