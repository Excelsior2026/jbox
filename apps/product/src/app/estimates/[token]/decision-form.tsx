'use client';

import { useState, type FormEvent } from 'react';
import styles from './estimate.module.css';

type Choice = 'approve' | 'decline' | null;

export function EstimateDecisionForm({
  token,
  intent,
  companyName,
}: {
  token: string;
  intent: 'approve' | 'decline' | null;
  companyName: string | null;
}) {
  const [choice, setChoice] = useState<Choice>(
    intent === 'approve' || intent === 'decline' ? intent : null,
  );
  const [signerName, setSignerName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !choice) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(
        `/api/customer/estimates/${encodeURIComponent(token)}/decision`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: choice === 'approve' ? 'approved' : 'declined',
            signerName,
            affirmativeConsent: choice === 'approve' && consent,
          }),
        },
      );
      const payload = await response.json() as {
        decision?: 'approved' | 'declined';
        error?: string;
      };
      if (!response.ok || !payload.decision) {
        throw new Error(payload.error || 'Your response could not be recorded.');
      }
      setResult({
        ok: true,
        message: payload.decision === 'approved'
          ? `Approved. ${companyName ?? 'The company'} has a record of your acceptance.`
          : `Declined. ${companyName ?? 'The company'} has a record of your response.`,
      });
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error
          ? error.message
          : 'Your response could not be recorded.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (result?.ok) {
    return <p className={styles.decisionSuccess} role="status">{result.message}</p>;
  }

  return (
    <form className={styles.decisionForm} onSubmit={submit}>
      <div>
        <p className={styles.eyebrow}>Decide on this estimate</p>
        <h2>
          {choice === 'approve'
            ? 'Confirm your approval'
            : choice === 'decline'
              ? 'Confirm that you decline'
              : 'Approve or decline this estimate'}
        </h2>
      </div>

      {!choice && (
        <div className={styles.choiceRow}>
          <button
            className={styles.approveButton}
            disabled={busy}
            type="button"
            onClick={() => setChoice('approve')}
          >
            Approve this estimate
          </button>
          <button
            className={styles.declineButton}
            disabled={busy}
            type="button"
            onClick={() => setChoice('decline')}
          >
            Decline this estimate
          </button>
        </div>
      )}

      {choice === 'approve' && (
        <>
          <label>
            Your full name
            <input
              autoComplete="name"
              maxLength={120}
              minLength={2}
              required
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
            />
          </label>
          <label className={styles.consent}>
            <input
              checked={consent}
              required
              type="checkbox"
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I reviewed this exact estimate and affirmatively approve its scope,
              pricing, and tax.
            </span>
          </label>
          <button
            className={styles.approveButton}
            disabled={busy}
            type="submit"
          >
            {busy ? 'Recording…' : 'Approve estimate'}
          </button>
        </>
      )}

      {choice === 'decline' && (
        <>
          <p className={styles.declineNotice}>
            This action records a decline for this exact estimate. It does not
            delete the document or your access history.
          </p>
          <button
            className={styles.declineButton}
            disabled={busy}
            type="submit"
          >
            {busy ? 'Recording…' : 'Decline estimate'}
          </button>
        </>
      )}

      {choice && (
        <button
          className={styles.backButton}
          disabled={busy}
          type="button"
          onClick={() => setChoice(null)}
        >
          Change choice
        </button>
      )}

      {result && !result.ok && (
        <p className={styles.decisionError} role="alert">{result.message}</p>
      )}
    </form>
  );
}
