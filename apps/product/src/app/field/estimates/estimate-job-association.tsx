'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import type { EstimateStatus } from '@/lib/estimate-contract';
import type { EstimateRecord } from '@/lib/estimate-record';
import { JOB_LIMITS, validateJobInput, type JobInput } from '@/lib/job-contract';
import type { JobRecord } from '@/lib/job-record';
import styles from '../field.module.css';

type ApiPayload = {
  estimate?: EstimateRecord;
  job?: JobRecord;
  error?: string;
  existingJobId?: string;
};

type Props = {
  estimateId: string;
  customerId: string;
  serviceRequestId: string | null;
  jobId: string | null;
  estimateStatus: EstimateStatus;
  defaultTitle: string;
  prepareAssociation: () => Promise<string | null>;
  onAssociated: (estimate: EstimateRecord, job: JobRecord) => void;
};

async function responsePayload(response: Response): Promise<ApiPayload> {
  try {
    return await response.json() as ApiPayload;
  } catch {
    return {};
  }
}

const initialJobInput = (title: string): JobInput => ({
  title: title.trim() || 'Electrical service',
  notes: '',
});

export default function EstimateJobAssociation({
  estimateId,
  customerId,
  serviceRequestId,
  jobId,
  estimateStatus,
  defaultTitle,
  prepareAssociation,
  onAssociated,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'existing' | 'create'>('existing');
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [existingJobId, setExistingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<JobInput>(() => initialJobInput(defaultTitle));

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    async function loadJobs() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ customerId });
        const response = await fetch(`/api/field/jobs?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const payload = await responsePayload(response);
        const candidates = (payload as ApiPayload & { jobs?: JobRecord[] }).jobs;
        if (!response.ok || !Array.isArray(candidates)) {
          throw new Error(payload.error || 'Compatible jobs could not be loaded.');
        }
        if (controller.signal.aborted) return;
        const compatible = candidates.filter((job) => (
          job.estimateId === null
          && job.serviceRequestId === serviceRequestId
          && job.status !== 'cancelled'
        ));
        setJobs(compatible);
        setMode(compatible.length ? 'existing' : 'create');
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error
          ? requestError.message
          : 'Compatible jobs could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadJobs();
    return () => controller.abort();
  }, [customerId, open, serviceRequestId]);

  async function associate(payload: { jobId: string } | { newJob: JobInput }) {
    setError('');
    setExistingJobId(null);
    const expectedUpdatedAt = await prepareAssociation();
    if (!expectedUpdatedAt) {
      setError('Save the estimate before linking a job.');
      return;
    }

    const target = 'jobId' in payload ? payload.jobId : 'new';
    setBusyJobId(target);
    try {
      const response = await fetch(
        `/api/field/estimates/${encodeURIComponent(estimateId)}/job`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, expectedUpdatedAt }),
        },
      );
      const result = await responsePayload(response);
      if (!response.ok || !result.estimate || !result.job) {
        if (result.existingJobId) setExistingJobId(result.existingJobId);
        throw new Error(result.error || 'The estimate could not be linked to a job.');
      }
      onAssociated(result.estimate, result.job);
      setOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'The estimate could not be linked to a job.');
    } finally {
      setBusyJobId(null);
    }
  }

  async function createAndAssociate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateJobInput(form);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    await associate({ newJob: validation.value });
  }

  if (jobId) {
    return (
      <section className={styles.estimateJobAssociation} aria-label="Linked job">
        <div>
          <span>Operational job</span>
          <strong>Estimate linked to a job</strong>
          <p>This association is immutable and recorded in both histories.</p>
        </div>
        <Link href={`/field/jobs/${jobId}`}>Open job</Link>
      </section>
    );
  }

  return (
    <>
      <section className={styles.estimateJobAssociation} aria-label="Job association">
        <div>
          <span>Operational job</span>
          <strong>{estimateStatus === 'declined' ? 'Job link unavailable' : 'No job linked'}</strong>
          <p>{estimateStatus === 'declined'
            ? 'Declined estimates remain historical records and cannot be newly linked.'
            : 'Create a job or select one already open for this customer.'}</p>
        </div>
        <button
          type="button"
          disabled={estimateStatus === 'declined'}
          onClick={() => {
            setForm(initialJobInput(defaultTitle));
            setOpen(true);
          }}
        >
          Create or link job
        </button>
      </section>

      {open && (
        <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busyJobId) setOpen(false);
        }}>
          <section
            className={`${styles.smallModal} ${styles.jobAssociationModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-association-title"
          >
            <div className={styles.modalHeader}>
              <div>
                <span>Immutable association</span>
                <h2 id="job-association-title">Link estimate to a job</h2>
              </div>
              <button
                type="button"
                aria-label="Close job association"
                disabled={Boolean(busyJobId)}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            <p className={styles.modalNote}>
              Only jobs already open for this customer are eligible, and the link
              cannot be changed after saving.
            </p>

            <div className={styles.jobAssociationTabs}>
              <button
                type="button"
                className={mode === 'existing' ? styles.jobAssociationTabActive : ''}
                onClick={() => setMode('existing')}
              >
                Existing job
              </button>
              <button
                type="button"
                className={mode === 'create' ? styles.jobAssociationTabActive : ''}
                onClick={() => setMode('create')}
              >
                New job
              </button>
            </div>

            {mode === 'existing' ? (
              <div className={styles.jobAssociationChoices}>
                {loading ? (
                  <p>Loading compatible jobs…</p>
                ) : jobs.length === 0 ? (
                  <p>No unlinked active jobs were found. Create a new job for this estimate.</p>
                ) : jobs.map((job) => (
                  <button
                    type="button"
                    key={job.id}
                    disabled={Boolean(busyJobId)}
                    onClick={() => void associate({ jobId: job.id })}
                  >
                    <span><strong>{job.title}</strong><small>{job.displayId} · {job.status.replace('_', ' ')}</small></span>
                    <i>{busyJobId === job.id ? 'Linking…' : 'Link'}</i>
                  </button>
                ))}
              </div>
            ) : (
              <form className={styles.jobAssociationForm} onSubmit={createAndAssociate}>
                <label>
                  Job title
                  <input
                    required
                    minLength={JOB_LIMITS.title.min}
                    maxLength={JOB_LIMITS.title.max}
                    value={form.title}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))}
                  />
                </label>
                <label>
                  Internal notes
                  <textarea
                    rows={4}
                    maxLength={JOB_LIMITS.notes.max}
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))}
                  />
                </label>
                <button className={styles.primaryAction} type="submit" disabled={Boolean(busyJobId)}>
                  {busyJobId === 'new' ? 'Creating…' : 'Create and link job'}
                </button>
              </form>
            )}

            {error && (
              <p className={styles.jobAssociationError} role="alert">
                {error}
                {existingJobId && (
                  <> <Link href={`/field/jobs/${existingJobId}`}>Open {existingJobId}</Link></>
                )}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
