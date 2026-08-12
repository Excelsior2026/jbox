import type { NextRequest } from 'next/server';
import { createCustomer, listCustomers } from '@/lib/customers';
import { validateCustomerInput } from '@/lib/customer-contract';
import { isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_SEARCH_LENGTH = 80;
const MAX_BODY_BYTES = 4096;

export async function GET(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'customers.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }

  const query = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (query.length > MAX_SEARCH_LENGTH) {
    return privateJson({ error: 'Search is too long' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => (
      privateJson({ customers: await listCustomers(query) })
    ));
  } catch (error) {
    console.error('Customer search failed.', error);
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'customers.write')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return privateJson({ error: 'Bad Request' }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'Invalid body' }, 400);
  }

  // Validate before touching the database. Every limit checked here is also a
  // CHECK constraint on `customers`, so skipping this turns a client mistake
  // into a caught Postgres error and a misleading 503.
  const validation = validateCustomerInput(body);
  if (!validation.ok) {
    return privateJson({ error: validation.error, field: validation.field }, 400);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => (
      privateJson({ customer: await createCustomer(validation.value) }, 201)
    ));
  } catch (error) {
    console.error('Customer create failed.', error);
    return privateJson({ error: 'Customer directory unavailable' }, 503);
  }
}
