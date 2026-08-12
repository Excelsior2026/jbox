import type { NextRequest } from 'next/server';
import { createCustomer, getCustomer } from '@/lib/customers';
import { validateCustomerInput } from '@/lib/customer-contract';
import { isDatabaseConfigured } from '@/lib/db';
import {
  type EstimateStatus,
  validateEstimateDraftInput,
} from '@/lib/estimate-contract';
import { createEstimate, listEstimates } from '@/lib/estimates';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { getClientIp } from '@/lib/rate-limit';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN } from '@/lib/ids';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 262144;
const STATUSES = new Set<EstimateStatus>(['draft', 'signed', 'declined']);

// Audit columns are unconstrained text; cap them here so a hostile header cannot
// bloat every estimate_events row it touches.
function auditContext(request: NextRequest) {
  return {
    ip: getClientIp(request).slice(0, 128),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
  };
}

export async function GET(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  const params = request.nextUrl.searchParams;
  const filter: {
    status?: EstimateStatus;
    customerId?: string;
    serviceRequestId?: string;
  } = {};

  const status = params.get('status');
  if (status !== null) {
    // An unrecognised status would reach `WHERE status = $1` and return an empty
    // list, which reads to the caller as "no estimates" rather than "bad filter".
    if (!STATUSES.has(status as EstimateStatus)) return privateJson({ error: 'Invalid status' }, 400);
    filter.status = status as EstimateStatus;
  }

  const customerId = params.get('customerId');
  if (customerId !== null) {
    if (!UUID_PATTERN.test(customerId)) return privateJson({ error: 'Invalid customerId' }, 400);
    filter.customerId = customerId;
  }

  const serviceRequestId = params.get('serviceRequestId');
  if (serviceRequestId !== null) {
    // Cast to ::uuid in listEstimates — a non-UUID raises a Postgres parse error.
    if (!UUID_PATTERN.test(serviceRequestId)) return privateJson({ error: 'Invalid serviceRequestId' }, 400);
    filter.serviceRequestId = serviceRequestId;
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => (
      privateJson({ estimates: await listEstimates(filter) })
    ));
  } catch (error) {
    console.error('Estimate list failed.', error);
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
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

  const hasCustomerId = body.customerId !== undefined && body.customerId !== null;
  const hasNewCustomer = body.newCustomer !== undefined && body.newCustomer !== null;
  if (hasCustomerId === hasNewCustomer) {
    return privateJson(
      { error: 'Provide exactly one of customerId or newCustomer.' },
      400,
    );
  }

  if (hasCustomerId && (typeof body.customerId !== 'string' || !UUID_PATTERN.test(body.customerId))) {
    return privateJson({ error: 'Invalid customerId' }, 400);
  }

  let serviceRequestId: string | null = null;
  if (body.serviceRequestId !== undefined && body.serviceRequestId !== null) {
    if (typeof body.serviceRequestId !== 'string' || !UUID_PATTERN.test(body.serviceRequestId)) {
      return privateJson({ error: 'Invalid serviceRequestId' }, 400);
    }
    serviceRequestId = body.serviceRequestId;
  }

  // Validate the new-customer payload before the draft so the caller learns about
  // the field they can see and fix, and so nothing is written on a bad request.
  let newCustomerInput: ReturnType<typeof validateCustomerInput> | null = null;
  if (hasNewCustomer) {
    if (!fieldPrincipalCan(principal, 'customers.write')) {
      return privateJson({ error: 'Unauthorized' }, 401);
    }
    newCustomerInput = validateCustomerInput(body.newCustomer);
    if (!newCustomerInput.ok) {
      return privateJson({ error: newCustomerInput.error, field: newCustomerInput.field }, 400);
    }
  }

  const draft = validateEstimateDraftInput(body.draft);
  if (!draft.ok) return privateJson({ error: draft.error }, 400);

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      let customerId: string;
      if (newCustomerInput?.ok) {
        // Deliberately not rolled back if the estimate insert fails below: an
        // unreferenced directory entry is harmless, whereas discarding it would
        // lose the customer details a technician just typed in the field.
        customerId = (await createCustomer(newCustomerInput.value)).id;
      } else {
        const existing = await getCustomer(body.customerId as string);
        // customer_id REFERENCES customers(id): without this the insert raises an
        // FK violation and the caller sees 503 instead of "that customer is gone".
        if (!existing) return privateJson({ error: 'Customer not found' }, 404);
        customerId = existing.id;
      }

      const { ip, userAgent } = auditContext(request);
      const estimate = await createEstimate(draft.value, { customerId, serviceRequestId, ip, userAgent });
      return privateJson({ estimate }, 201);
    });
  } catch (error) {
    console.error('Estimate create failed.', error);
    return privateJson({ error: 'Estimates unavailable' }, 503);
  }
}
