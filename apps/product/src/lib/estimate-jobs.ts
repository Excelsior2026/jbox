import 'server-only';

import { DEFAULT_DOCUMENT_PREFIXES } from '@contractor-platform/configuration';
import { db } from '@/lib/db';
import type { EstimateRecord } from '@/lib/estimate-record';
import { getEstimate } from '@/lib/estimates';
import type { JobInput } from '@/lib/job-contract';
import type { JobRecord } from '@/lib/job-record';
import { getJob, type JobEventContext } from '@/lib/jobs';
import { requireOrganizationContext } from '@/lib/organization-context-store';
import { loadInForceConfig } from '@/lib/tenant';

export type EstimateJobAssociation = {
  estimate: EstimateRecord;
  job: JobRecord;
  reused: boolean;
};

export type EstimateJobFailure =
  | { reason: 'estimate-not-found' }
  | { reason: 'job-not-found' }
  | { reason: 'estimate-terminal' }
  | { reason: 'job-terminal' }
  | { reason: 'customer-mismatch' }
  | { reason: 'request-mismatch' }
  | { reason: 'conflict' }
  | { reason: 'estimate-linked'; existingJobId: string };

export type EstimateJobResult =
  | { ok: true; value: EstimateJobAssociation }
  | { ok: false; failure: EstimateJobFailure };

type EstimateLinkRow = Record<string, unknown>;

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null
  && (error as { code?: string }).code === '23505';

async function readAssociation(
  estimateId: string,
  jobId: string,
  reused: boolean,
): Promise<EstimateJobResult> {
  const [estimate, job] = await Promise.all([
    getEstimate(estimateId),
    getJob(jobId),
  ]);
  if (!estimate) return { ok: false, failure: { reason: 'estimate-not-found' } };
  if (!job) return { ok: false, failure: { reason: 'job-not-found' } };
  return { ok: true, value: { estimate, job, reused } };
}

/**
 * After a guarded write races to zero rows (or trips the one-job-per-estimate
 * unique index), re-read and classify rather than guess: a same-link retry is
 * idempotent, a different link is a conflict the caller can surface, and
 * nothing encourages a duplicate job.
 */
async function reclassify(estimateId: string, jobId: string): Promise<EstimateJobResult> {
  const estimate = await getEstimate(estimateId);
  if (!estimate) return { ok: false, failure: { reason: 'estimate-not-found' } };
  if (estimate.jobId === jobId) return readAssociation(estimateId, jobId, true);
  if (estimate.jobId) {
    return { ok: false, failure: { reason: 'estimate-linked', existingJobId: estimate.jobId } };
  }
  return { ok: false, failure: { reason: 'conflict' } };
}

const timestampToken = (row: EstimateLinkRow, column: 'updated_at') => {
  const exactToken = row[`${column}_token`];
  if (typeof exactToken === 'string') return exactToken;
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
};

export async function linkEstimateToJob(
  estimateId: string,
  jobId: string,
  expectedUpdatedAt: string,
  ctx: JobEventContext,
): Promise<EstimateJobResult> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;

  // One read names the estimate, its current link, and the candidate job, so
  // classification is a single consistent snapshot before the guarded write.
  const rows = (await sql`
    SELECT
      estimate.id,
      estimate.customer_id,
      estimate.service_request_id,
      estimate.status,
      to_json(estimate.updated_at) AS updated_at_token,
      (SELECT job.id FROM jobs job
        WHERE job.estimate_id = estimate.id
          AND job.organization_id = estimate.organization_id
        ORDER BY job.created_at, job.id LIMIT 1) AS linked_job_id,
      job.id AS linked_id,
      job.customer_id AS linked_customer_id,
      job.service_request_id AS linked_service_request_id,
      job.status AS linked_status
    FROM estimates AS estimate
    LEFT JOIN jobs AS job ON job.id = ${jobId}
    WHERE estimate.id = ${estimateId}
    LIMIT 1
  `) as EstimateLinkRow[];
  const current = rows[0];

  if (!current) return { ok: false, failure: { reason: 'estimate-not-found' } };

  const linkedJobId = (current.linked_job_id as string) ?? null;
  if (linkedJobId) {
    if (linkedJobId === jobId) return readAssociation(estimateId, jobId, true);
    return {
      ok: false,
      failure: { reason: 'estimate-linked', existingJobId: linkedJobId },
    };
  }
  if (current.status === 'declined') {
    return { ok: false, failure: { reason: 'estimate-terminal' } };
  }
  if (timestampToken(current, 'updated_at') !== expectedUpdatedAt) {
    return { ok: false, failure: { reason: 'conflict' } };
  }
  if (!current.linked_id) return { ok: false, failure: { reason: 'job-not-found' } };
  if (current.linked_status === 'cancelled') {
    return { ok: false, failure: { reason: 'job-terminal' } };
  }
  if (current.linked_customer_id !== current.customer_id) {
    return { ok: false, failure: { reason: 'customer-mismatch' } };
  }
  if (current.linked_service_request_id !== current.service_request_id) {
    return { ok: false, failure: { reason: 'request-mismatch' } };
  }

  // The guard re-checks every classification inside one statement, and the
  // estimate-side EXISTS keeps a signed/declined/drifted estimate out of the
  // link even if the pre-read raced.
  let linked: EstimateLinkRow[];
  try {
    linked = (await sql`
      WITH linked AS (
        UPDATE jobs
        SET estimate_id = ${estimateId}::uuid, updated_at = now()
        WHERE id = ${jobId}::uuid
          AND estimate_id IS NULL
          AND status <> 'cancelled'
          AND customer_id = ${current.customer_id}::uuid
          AND service_request_id IS NOT DISTINCT FROM ${current.service_request_id}::uuid
          AND EXISTS (
            SELECT 1 FROM estimates
            WHERE id = ${estimateId}::uuid
              AND status <> 'declined'
              AND updated_at = ${expectedUpdatedAt}::timestamptz
          )
        RETURNING id
      ),
      estimate_logged AS (
        INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
        SELECT app_require_organization_id(), ${estimateId}, 'job_linked', ${actorId},
               jsonb_build_object('job_id', ${jobId}::text,
                                  'request_ip', ${ctx.ip}::text,
                                  'user_agent', ${ctx.userAgent}::text)
        FROM linked
        RETURNING estimate_id
      ),
      job_logged AS (
        INSERT INTO job_events (organization_id, job_id, event, actor_id, meta)
        SELECT app_require_organization_id(), id, 'estimate_linked', ${actorId},
               jsonb_build_object('estimate_id', ${estimateId}::text,
                                  'request_ip', ${ctx.ip}::text,
                                  'user_agent', ${ctx.userAgent}::text)
        FROM linked
        RETURNING job_id
      )
      SELECT id FROM linked
    `) as EstimateLinkRow[];
  } catch (error) {
    if (isUniqueViolation(error)) return reclassify(estimateId, jobId);
    throw error;
  }

  if (linked.length) return readAssociation(estimateId, jobId, false);
  return reclassify(estimateId, jobId);
}

export async function createJobForEstimate(
  estimateId: string,
  input: JobInput,
  expectedUpdatedAt: string,
  ctx: JobEventContext,
): Promise<EstimateJobResult> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;

  const estimate = await getEstimate(estimateId);
  if (!estimate) return { ok: false, failure: { reason: 'estimate-not-found' } };
  if (estimate.jobId) {
    return {
      ok: false,
      failure: { reason: 'estimate-linked', existingJobId: estimate.jobId },
    };
  }
  if (estimate.status === 'declined') {
    return { ok: false, failure: { reason: 'estimate-terminal' } };
  }
  if (estimate.updatedAt !== expectedUpdatedAt) {
    return { ok: false, failure: { reason: 'conflict' } };
  }

  const config = await loadInForceConfig();
  const prefix = config?.documents.prefixes.job ?? DEFAULT_DOCUMENT_PREFIXES.job;

  // target's NOT EXISTS re-checks the one-job-per-estimate rule inside the
  // statement; the unique index in migration 011 is the arbiter for races.
  let created: EstimateLinkRow[];
  try {
    created = (await sql`
      WITH allocated AS (
        SELECT allocate_document_number('job') AS n
      ),
      target AS (
        SELECT id, customer_id, service_request_id
        FROM estimates
        WHERE id = ${estimateId}::uuid
          AND status <> 'declined'
          AND updated_at = ${expectedUpdatedAt}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM jobs
            WHERE estimate_id = estimates.id
              AND organization_id = app_require_organization_id()
          )
      ),
      inserted_job AS (
        INSERT INTO jobs (organization_id, document_number, display_id, customer_id,
                          service_request_id, estimate_id, status, title, notes)
        SELECT app_require_organization_id(), allocated.n,
               ${`${prefix}-`} || lpad(allocated.n::text, 4, '0'),
               target.customer_id, target.service_request_id, target.id,
               'scheduled', ${input.title}, ${input.notes}
        FROM allocated CROSS JOIN target
        RETURNING id, customer_id, service_request_id
      ),
      job_created_logged AS (
        INSERT INTO job_events (organization_id, job_id, event, actor_id, meta)
        SELECT app_require_organization_id(), id, 'created', ${actorId},
               jsonb_build_object('customer_id', customer_id::text,
                                  'service_request_id', service_request_id::text,
                                  'created_from_estimate_id', ${estimateId}::text,
                                  'request_ip', ${ctx.ip}::text,
                                  'user_agent', ${ctx.userAgent}::text)
        FROM inserted_job
        RETURNING job_id
      ),
      job_linked_logged AS (
        INSERT INTO job_events (organization_id, job_id, event, actor_id, meta)
        SELECT app_require_organization_id(), id, 'estimate_linked', ${actorId},
               jsonb_build_object('estimate_id', ${estimateId}::text,
                                  'request_ip', ${ctx.ip}::text,
                                  'user_agent', ${ctx.userAgent}::text)
        FROM inserted_job
        RETURNING job_id
      ),
      estimate_logged AS (
        INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
        SELECT app_require_organization_id(), ${estimateId}, 'job_linked', ${actorId},
               jsonb_build_object('job_id', id::text, 'created', true,
                                  'request_ip', ${ctx.ip}::text,
                                  'user_agent', ${ctx.userAgent}::text)
        FROM inserted_job
        RETURNING estimate_id
      )
      SELECT id FROM inserted_job
    `) as EstimateLinkRow[];
  } catch (error) {
    if (isUniqueViolation(error)) return reclassify(estimateId, '');
    throw error;
  }

  if (created.length) return readAssociation(estimateId, created[0].id as string, false);
  return reclassify(estimateId, '');
}
