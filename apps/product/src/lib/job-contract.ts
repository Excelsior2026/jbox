// Deliberately NOT `server-only`: the field form imports JOB_LIMITS to
// constrain input as the technician types, and the API routes import
// validateJobInput as the backstop for anything that reaches the jobs API
// another way — a stale client, a retry, a direct call.
//
// These values mirror the CHECK constraints on `jobs` in
// packages/database/migrations/004_service_requests_jobs_invoices_receipts_inventory.sql
// and the new intake context fields from migration 016.
// Change them together.

export const JOB_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobFieldName = 'title' | 'notes' | 'customerStatedProblem' | 'technicianDiagnosis';

export const JOB_LIMITS = {
  // title: char_length BETWEEN 2 AND 200
  title: { min: 2, max: 200, label: 'Title' },
  // notes: char_length <= 4000 (no minimum; a blank persists as '')
  notes: { min: 0, max: 4000, label: 'Notes' },
  // customer_stated_problem: char_length <= 4000 (no minimum; a blank persists as '')
  customerStatedProblem: { min: 0, max: 4000, label: 'Customer stated problem' },
  // technician_diagnosis: char_length <= 4000 (no minimum; a blank persists as '')
  technicianDiagnosis: { min: 0, max: 4000, label: 'Technician diagnosis' },
} as const;

export type JobInput = {
  title: string;
  notes: string;
  customerStatedProblem: string;
  technicianDiagnosis: string;
};

export type JobValidation =
  | { ok: true; value: JobInput }
  | { ok: false; error: string; field: JobFieldName | null };

export function validateJobInput(value: unknown): JobValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Job must be an object.', field: null };
  }

  const raw = value as Record<string, unknown>;
  const result = {} as JobInput;

  for (const field of ['title', 'notes', 'customerStatedProblem', 'technicianDiagnosis'] as const) {
    const limit = JOB_LIMITS[field];
    const supplied = raw[field];

    // Check the type before the length. `String({})` is '[object Object]' — 15
    // characters, which satisfies every limit here and would persist silently.
    if (typeof supplied !== 'string') {
      return { ok: false, error: `${limit.label} must be text.`, field };
    }

    const trimmed = supplied.trim();

    if (trimmed === '') {
      if (limit.min > 0) return { ok: false, error: `${limit.label} is required.`, field };
      result[field] = '';
      continue;
    }

    if (trimmed.length < limit.min || trimmed.length > limit.max) {
      const requirement = limit.min
        ? `between ${limit.min} and ${limit.max}`
        : `at most ${limit.max}`;
      return {
        ok: false,
        error: `${limit.label} must be ${requirement} characters.`,
        field,
      };
    }

    result[field] = trimmed;
  }

  return { ok: true, value: result };
}
