import 'server-only';

import { db } from '@/lib/db';
import type { JobStatus } from '@/lib/job-contract';
import type { JobRecord } from '@/lib/job-record';
import { requireOrganizationContext } from '@/lib/organization-context-store';

export type { JobRecord } from '@/lib/job-record';

export type JobListFilter = {
  /** Jobs for exactly one customer. */
  customerId?: string;
  status?: JobStatus;
  limit?: number;
};

export type ScheduledJobSummary = {
  id: string;
  displayId: string;
  customerId: string;
  customerName: string;
  title: string;
  status: JobStatus;
  scheduledStartAt: string;
};

/** Audit context shared by every job write path. The actor is resolved from
 * the organization context inside the write (see estimates.ts). */
export type JobEventContext = {
  ip: string | null;
  userAgent: string | null;
};

type JobRow = Record<string, unknown>;

const timestampToken = (row: JobRow, column: 'created_at' | 'updated_at') => {
  const exactToken = row[`${column}_token`];
  if (typeof exactToken === 'string') return exactToken;
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
};

function mapJob(r: JobRow): JobRecord {
  return {
    id: r.id as string,
    displayId: r.display_id as string,
    customerId: r.customer_id as string,
    customerName: r.customer_name as string,
    serviceRequestId: (r.service_request_id as string) ?? null,
    estimateId: (r.estimate_id as string) ?? null,
    status: r.status as JobStatus,
    title: r.title as string,
    notes: (r.notes as string) ?? '',
    customerStatedProblem: (r.customer_stated_problem as string) ?? '',
    technicianDiagnosis: (r.technician_diagnosis as string) ?? '',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

const JOB_SELECT = `
  SELECT
    job.*,
    customer.display_name AS customer_name,
    to_json(job.created_at) AS created_at_token,
    to_json(job.updated_at) AS updated_at_token
  FROM jobs AS job
  JOIN customers AS customer ON customer.id = job.customer_id
`;

export async function getJob(id: string): Promise<JobRecord | null> {
  const rows = (await db().query(
    `${JOB_SELECT} WHERE job.id = $1 LIMIT 1`,
    [id],
  )) as JobRow[];
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function listJobs(filter: JobListFilter = {}): Promise<JobRecord[]> {
  const customerId = filter.customerId ?? null;
  const status = filter.status ?? null;
  const rawLimit = filter.limit ?? 50;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : 50;

  const rows = (await db().query(
    `${JOB_SELECT}
     WHERE ($1::uuid IS NULL OR job.customer_id = $1::uuid)
       AND ($2::text IS NULL OR job.status = $2::text)
     ORDER BY job.updated_at DESC, job.id
     LIMIT $3`,
    [customerId, status, limit],
  )) as JobRow[];
  return rows.map(mapJob);
}

/** Returns only jobs scheduled within the supplied half-open UTC interval. */
export async function listScheduledJobs(
  startInclusive: string,
  endExclusive: string,
  limit = 100,
): Promise<ScheduledJobSummary[]> {
  const context = requireOrganizationContext();
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const rows = (await db().query(
    `SELECT
       job.id,
       job.display_id,
       job.customer_id,
       customer.display_name AS customer_name,
       job.title,
       job.status,
       to_json(job.scheduled_start_at) AS scheduled_start_at_token
     FROM jobs AS job
     JOIN customers AS customer
       ON customer.id = job.customer_id
      AND customer.organization_id = job.organization_id
     WHERE job.organization_id = $1::uuid
       AND job.scheduled_start_at >= $2::timestamptz
       AND job.scheduled_start_at < $3::timestamptz
       AND job.status <> 'cancelled'
     ORDER BY job.scheduled_start_at ASC, job.id
     LIMIT $4`,
    [context.organizationId, startInclusive, endExclusive, boundedLimit],
  )) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    displayId: row.display_id as string,
    customerId: row.customer_id as string,
    customerName: row.customer_name as string,
    title: row.title as string,
    status: row.status as JobStatus,
    scheduledStartAt: String(row.scheduled_start_at_token ?? ''),
  }));
}

/**
 * Creates an immutable snapshot of the job state at a key lifecycle point.
 * This preserves the legal paper trail and ensures the original context
 * of the call is never overwritten or lost.
 */
export async function createJobSnapshot(
  jobId: string,
  snapshotType: 'initial_request' | 'approved_estimate' | 'change_order' | 'final_invoice' | 'status_change',
  referenceDocumentType: 'estimate' | 'invoice' | 'change_order' | null,
  referenceDocumentId: string | null,
  snapshotReason: string,
  _ctx: JobEventContext,
): Promise<string | null> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  
  const rows = (await sql.query(
    `SELECT create_job_snapshot(
      $1::uuid,
      $2::text,
      $3::text,
      $4::uuid,
      $5::text,
      $6::uuid
    ) AS snapshot_id`,
    [
      jobId,
      snapshotType,
      referenceDocumentType,
      referenceDocumentId,
      snapshotReason,
      actorId,
    ],
  )) as Array<{ snapshot_id: string }>;
  
  return rows[0]?.snapshot_id ?? null;
}
