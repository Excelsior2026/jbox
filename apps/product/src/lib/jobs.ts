import 'server-only';

import { db } from '@/lib/db';
import type { JobStatus } from '@/lib/job-contract';
import type { JobRecord } from '@/lib/job-record';

export type { JobRecord } from '@/lib/job-record';

export type JobListFilter = {
  /** Jobs for exactly one customer. */
  customerId?: string;
  status?: JobStatus;
  limit?: number;
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
