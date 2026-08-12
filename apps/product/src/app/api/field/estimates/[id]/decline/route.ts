import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { isDatabaseConfigured } from '@/lib/db';
import { declineEstimate } from '@/lib/estimates';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN as ID_PATTERN } from '@/lib/ids';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }

  const { id } = await params;
  if (!ID_PATTERN.test(id)) return privateJson({ error: 'Not found' }, 404);

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const result = await declineEstimate(id, {
        ip: getClientIp(request).slice(0, 128),
        userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
      });

      if (result.ok) return privateJson({ estimate: result.value });
      if (result.reason === 'not-found') return privateJson({ error: 'Not found' }, 404);

      // Only a draft may be declined. Signed and declined are both terminal, so
      // retrying can never succeed — say so, matching the PATCH route's shape.
      return privateJson({
        error: 'This estimate is already signed or declined.',
        reason: 'locked',
        retryable: false,
      }, 409);
    });
  } catch (error) {
    console.error('Estimate decline failed.', error);
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }
}
