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
  
  /**
   * Customer intake context fields.
   * These separate the "Customer's Stated Problem" from the "Technician's
   * Actual Diagnosis" so the original context of the call is never
   * overwritten or lost.
   */
  customerStatedProblem: string;
  technicianDiagnosis: string;
  
  createdAt: string;
  updatedAt: string;
};
