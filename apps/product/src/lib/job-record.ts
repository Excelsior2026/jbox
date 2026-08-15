import type { JobStatus } from '@/lib/job-contract';

/**
 * A job as the field workspace sees it. jbox has no service-address/town
 * columns on jobs (the prototype did); the working address lives on the
 * customer record, and a job names that customer.
 */
export type JobRecord = {
  id: string;
  displayId: string;
  customerId: string;
  customerName: string;
  serviceRequestId: string | null;
  /** The estimate that justified this job; null until association. */
  estimateId: string | null;
  status: JobStatus;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
