import type { NextRequest } from 'next/server';
import { validateCustomerInput } from '@/lib/customer-contract';
import { getCustomer, updateCustomer } from '@/lib/customers';
import { isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN } from '@/lib/ids';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

// jbox customers are addressed by their internal uuid (migration 002), not the
// display id the prototype used. Anything that is not a well-formed uuid is a
// "not found", not a database query.

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'customers.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return privateJson({ error: 'Customer not found' }, 404);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const customer = await getCustomer(id);
      return customer
        ? privateJson({ customer })
        : privateJson({ error: 'Customer not found' }, 404);
    });
  } catch (error) {
    console.error('Customer read failed.', error);
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'customers.write')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return privateJson({ error: 'Customer not found' }, 404);
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return privateJson({ error: 'Bad Request' }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid body' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return privateJson({ error: 'Body must be an object.' }, 400);
  }

  const validation = validateCustomerInput(body.customer);
  if (!validation.ok) {
    return privateJson({ error: validation.error, field: validation.field }, 400);
  }

  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (
    typeof expectedUpdatedAt !== 'string'
    || expectedUpdatedAt.length > 80
    || Number.isNaN(Date.parse(expectedUpdatedAt))
  ) {
    return privateJson({ error: 'expectedUpdatedAt is required.' }, 400);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const result = await updateCustomer(id, validation.value, expectedUpdatedAt);
      if (!result.ok) {
        return result.reason === 'not-found'
          ? privateJson({ error: 'Customer not found', reason: result.reason }, 404)
          : privateJson({
              error: 'This customer changed elsewhere. Reload before saving again.',
              reason: result.reason,
              retryable: true,
            }, 409);
      }
      return privateJson({ customer: result.value });
    });
  } catch (error) {
    console.error('Customer update failed.', error);
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }
}
