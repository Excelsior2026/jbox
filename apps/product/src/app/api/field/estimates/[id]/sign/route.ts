import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { isDatabaseConfigured } from '@/lib/db';
import { signEstimate } from '@/lib/estimates';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN as ID_PATTERN } from '@/lib/ids';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_SIGNER_NAME = 120;
const MAX_BODY_BYTES = 4096;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.approve')) {
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

  const signerName = typeof body.signerName === 'string' ? body.signerName.trim() : '';
  if (signerName.length < 1 || signerName.length > MAX_SIGNER_NAME) {
    return privateJson({ error: 'A signer name is required.', field: 'signerName' }, 400);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const result = await signEstimate(
        id,
        { signerName, signatureContext: 'protected-published' },
        {
          ip: getClientIp(request).slice(0, 128),
          userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
        },
      );

      if (result.ok) return privateJson({ estimate: result.value });
      if (result.reason === 'not-found') return privateJson({ error: 'Not found' }, 404);
      if (result.reason === 'invalid-context') {
        return privateJson({ error: 'Invalid signing context.', reason: 'invalid-context' }, 422);
      }
      return privateJson({
        error: 'This estimate is already signed or declined.',
        reason: 'locked',
        retryable: false,
      }, 409);
    });
  } catch (error) {
    console.error('Estimate sign failed.', error);
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }
}
