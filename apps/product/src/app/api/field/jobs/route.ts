import type { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN } from '@/lib/ids';
import { listJobs } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'jobs.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Jobs unavailable' }, 503);
  }

  const customerId = request.nextUrl.searchParams.get('customerId') ?? undefined;
  if (customerId && !UUID_PATTERN.test(customerId)) {
    return privateJson({ error: 'Invalid customerId' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => (
      privateJson({ jobs: await listJobs({ customerId, limit: 50 }) })
    ));
  } catch (error) {
    console.error('Job list failed.', error);
    return privateJson({ error: 'Jobs unavailable' }, 503);
  }
}
