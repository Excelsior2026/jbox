import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { isDatabaseConfigured } from '@/lib/db';
import {
  createJobForEstimate,
  linkEstimateToJob,
  type EstimateJobFailure,
} from '@/lib/estimate-jobs';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';
import { UUID_PATTERN as ID_PATTERN } from '@/lib/ids';
import { validateJobInput } from '@/lib/job-contract';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16384;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function failureResponse(failure: EstimateJobFailure) {
  if (failure.reason === 'estimate-not-found' || failure.reason === 'job-not-found') {
    return privateJson({ error: 'Not found', reason: failure.reason }, 404);
  }
  if (failure.reason === 'conflict') {
    return privateJson({
      error: 'This estimate changed since you loaded it. Reload and try again.',
      reason: failure.reason,
      retryable: true,
    }, 409);
  }
  if (failure.reason === 'estimate-linked') {
    return privateJson({
      error: 'This estimate is already linked to another job.',
      reason: failure.reason,
      existingJobId: failure.existingJobId,
      retryable: false,
    }, 409);
  }

  const messages = {
    'estimate-terminal': 'A declined estimate cannot be linked to a job.',
    'job-terminal': 'A cancelled job cannot receive a new estimate.',
    'customer-mismatch': 'The estimate and job belong to different customers.',
    'request-mismatch': 'The estimate and job have different service-request links.',
  } as const;
  return privateJson({
    error: messages[failure.reason],
    reason: failure.reason,
    retryable: false,
  }, 409);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const principal = await getFieldPrincipal();
  if (
    !fieldPrincipalCan(principal, 'estimates.prepare')
    || !fieldPrincipalCan(principal, 'jobs.write')
  ) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }
  if (!publicRequestIsSameOrigin(request)) {
    return privateJson({ error: 'Forbidden' }, 403);
  }

  const { id } = await params;
  if (!ID_PATTERN.test(id)) return privateJson({ error: 'Not found' }, 404);

  const contentLength = request.headers.get('content-length');
  if (
    contentLength
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
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

  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (
    typeof expectedUpdatedAt !== 'string'
    || expectedUpdatedAt === ''
    || expectedUpdatedAt.length > 80
  ) {
    return privateJson({ error: 'expectedUpdatedAt is required.' }, 400);
  }

  const hasJobId = body.jobId !== undefined && body.jobId !== null;
  const hasNewJob = body.newJob !== undefined && body.newJob !== null;
  if (hasJobId === hasNewJob) {
    return privateJson({ error: 'Provide exactly one of jobId or newJob.' }, 400);
  }

  let jobId: string | null = null;
  let newJob: ReturnType<typeof validateJobInput> | null = null;
  if (hasJobId) {
    if (typeof body.jobId !== 'string' || !ID_PATTERN.test(body.jobId)) {
      return privateJson({ error: 'Invalid jobId' }, 400);
    }
    jobId = body.jobId;
  } else {
    newJob = validateJobInput(body.newJob);
    if (!newJob.ok) {
      return privateJson({ error: newJob.error, field: newJob.field }, 400);
    }
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Estimate job workflow unavailable' }, 503);
  }

  const audit = {
    ip: getClientIp(request).slice(0, 128),
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
  };

  try {
    return await withFieldContext(principal, async () => {
      const result = jobId
        ? await linkEstimateToJob(id, jobId, expectedUpdatedAt, audit)
        : await createJobForEstimate(id, newJob!.value, expectedUpdatedAt, audit);
      if (!result.ok) return failureResponse(result.failure);
      return privateJson(
        {
          estimate: result.value.estimate,
          job: result.value.job,
          reused: result.value.reused,
        },
        !jobId && !result.value.reused ? 201 : 200,
      );
    });
  } catch (error) {
    console.error('Estimate job association failed.', error);
    return privateJson({ error: 'Estimate job workflow unavailable' }, 503);
  }
}
