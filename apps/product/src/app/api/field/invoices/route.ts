import type { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN } from '@/lib/ids';
import { getClientIp } from '@/lib/rate-limit';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';
import { createInvoiceFromEstimate, listInvoices } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

// Audit columns are unconstrained text; cap them here so a hostile header cannot
// bloat every invoice_events row it touches.
function auditContext(request: NextRequest) {
  return {
    ip: getClientIp(request).slice(0, 128),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
  };
}

export async function GET(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'invoices.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  const params = request.nextUrl.searchParams;
  const filter: { estimateId?: string; customerId?: string; jobId?: string } = {};

  for (const key of ['estimateId', 'customerId', 'jobId'] as const) {
    const value = params.get(key);
    if (value !== null) {
      if (!UUID_PATTERN.test(value)) return privateJson({ error: `Invalid ${key}` }, 400);
      filter[key] = value;
    }
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => (
      privateJson({ invoices: await listInvoices(filter) })
    ));
  } catch (error) {
    console.error('Invoice list failed.', error);
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'invoices.open')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }

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
  if (typeof body.estimateId !== 'string' || !UUID_PATTERN.test(body.estimateId)) {
    return privateJson({ error: 'Invalid estimateId' }, 400);
  }
  if (typeof body.expectedUpdatedAt !== 'string' || body.expectedUpdatedAt.length === 0) {
    return privateJson({ error: 'expectedUpdatedAt is required.' }, 400);
  }
  const payload = body as { estimateId: string; expectedUpdatedAt: string };

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const result = await createInvoiceFromEstimate(
        payload.estimateId,
        payload.expectedUpdatedAt,
        auditContext(request),
      );
      if (result.ok) {
        return privateJson(
          { invoice: result.value, reused: result.reused },
          result.reused ? 200 : 201,
        );
      }
      if (result.reason === 'estimate-not-found' || result.reason === 'job-not-found') {
        return privateJson({ error: 'Not found', reason: result.reason }, 404);
      }

      const messages = {
        'estimate-not-signed': 'Only a signed estimate can create an internal invoice draft.',
        'job-required': 'Link the estimate to a job before creating an invoice.',
        'job-terminal': 'A cancelled job cannot create a new invoice.',
        conflict: 'The estimate changed since you loaded it. Reload and try again.',
      } as const;
      return privateJson({
        error: messages[result.reason],
        reason: result.reason,
        retryable: result.reason === 'conflict',
      }, 409);
    });
  } catch (error) {
    console.error('Invoice create failed.', error);
    return privateJson({ error: 'Invoices unavailable' }, 503);
  }
}
