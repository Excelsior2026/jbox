import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { isDatabaseConfigured } from '@/lib/db';
import { duplicateEstimate } from '@/lib/estimates';
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
      // Any status may be duplicated on purpose: signed and declined are terminal,
      // so duplicating into a fresh draft is the only sanctioned way to revise one.
      const estimate = await duplicateEstimate(id, {
        ip: getClientIp(request).slice(0, 128),
        userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
      });

      return estimate
        ? privateJson({ estimate }, 201)
        : privateJson({ error: 'Not found' }, 404);
    });
  } catch (error) {
    console.error('Estimate duplicate failed.', error);
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }
}
