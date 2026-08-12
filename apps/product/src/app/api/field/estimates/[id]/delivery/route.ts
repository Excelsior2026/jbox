import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { isDatabaseConfigured } from '@/lib/db';
import {
  createEstimateDelivery,
  DEFAULT_ESTIMATE_TIME_ZONE,
} from '@/lib/estimate-delivery';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN } from '@/lib/ids';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 512;

function validTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return DEFAULT_ESTIMATE_TIME_ZONE;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return DEFAULT_ESTIMATE_TIME_ZONE;
  }
}

function deliveryFailureStatus(reason: string) {
  if (reason === 'estimate-not-found') return 404;
  if (reason === 'estimate-not-draft' || reason === 'customer-email-missing') return 409;
  return 503;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.send')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimate delivery unavailable.' }, 503);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return privateJson({ error: 'Not found' }, 404);
  }

  const contentLength = request.headers.get('content-length');
  if (
    contentLength
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return privateJson({ error: 'Bad Request' }, 400);
  }
  let timeZone = DEFAULT_ESTIMATE_TIME_ZONE;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    timeZone = validTimeZone(body.timeZone);
  } catch {
    // Empty body: the tenant's default time zone is used.
  }

  try {
    const result = await withFieldContext(principal, () =>
      createEstimateDelivery({ estimateId: id, timeZone }),
    );
    if (result.ok) {
      return privateJson({
        estimate: result.estimate,
        delivery: result.delivery,
      }, 202);
    }
    return privateJson({
      error: 'This estimate is not ready for customer delivery.',
      reason: result.reason,
    }, deliveryFailureStatus(result.reason));
  } catch {
    console.error('Estimate delivery preparation failed.');
    return privateJson({ error: 'Estimate delivery unavailable.' }, 503);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.send')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimate delivery unavailable.' }, 503);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return privateJson({ error: 'Not found' }, 404);
  }

  try {
    const revoked = await withFieldContext(principal, async () => {
      const rows = (await db().query(
        `UPDATE customer_access_grants
            SET status = 'revoked', revoked_at = now(), updated_at = now()
          WHERE document_type = 'estimate'
            AND document_id = $1
            AND status = 'active'
          RETURNING id`,
        [id],
      )) as Array<{ id: string }>;
      return rows.length;
    });
    return revoked > 0
      ? privateJson({ revoked: true, linkCount: revoked })
      : privateJson({ error: 'No active customer links were found.' }, 404);
  } catch {
    console.error('Estimate customer-link revocation failed.');
    return privateJson({ error: 'Estimate delivery unavailable.' }, 503);
  }
}
