'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { EstimateRecord } from '@/lib/estimate-record';
import { shortDate } from '../format';
import styles from '../field.module.css';

type EstimateActionsProps = {
  estimate: EstimateRecord;
  canPrepare: boolean;
  canApprove: boolean;
  canSend: boolean;
};

type Notice = { kind: 'ok' | 'error'; message: string };

const DELIVERY_REASONS: Record<string, string> = {
  'estimate-not-found': 'This estimate no longer exists.',
  'estimate-not-draft': 'Only a draft can be sent; this estimate is already signed or declined.',
  'customer-email-missing': 'This customer has no email on file, so no delivery link can be sent.',
  'delivery-not-configured': 'Customer delivery is not configured for this organization yet.',
  'link-tokens-not-configured': 'Secure customer links are not configured on this deployment yet.',
  'tenant-host-not-found': 'This organization has no verified public site to host the link.',
};

/**
 * Lifecycle actions for one estimate. Each maps to the matching Field API
 * endpoint so the server's capability, origin, and state checks all apply.
 * Sign and decline are one-way transitions guarded server-side; duplicate is
 * the sanctioned way to revise a terminal estimate; delivery issues the
 * customer access links and queues the estimate_delivery email.
 */
export function EstimateActions({ estimate, canPrepare, canApprove, canSend }: EstimateActionsProps) {
  const router = useRouter();
  const isDraft = estimate.status === 'draft';

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signing, setSigning] = useState(false);
  const [delivered, setDelivered] = useState(false);

  async function post(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { response, payload: await response.json() as Record<string, unknown> };
  }

  async function sign() {
    if (!signerName.trim() || busy) return;
    setBusy('sign');
    setNotice(null);
    try {
      const { response, payload } = await post(
        `/api/field/estimates/${estimate.id}/sign`,
        { signerName: signerName.trim() },
      );
      if (!response.ok) {
        throw new Error(String(payload.error ?? 'The estimate could not be signed.'));
      }
      setSigning(false);
      setSignerName('');
      setNotice({ kind: 'ok', message: `Signed. ${estimate.displayId} is now a binding published estimate.` });
      router.refresh();
    } catch (caught) {
      setNotice({ kind: 'error', message: caught instanceof Error ? caught.message : 'Signing failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    if (busy) return;
    if (!window.confirm(`Decline ${estimate.displayId}? This is final for this estimate; revise by duplicating it.`)) {
      return;
    }
    setBusy('decline');
    setNotice(null);
    try {
      const { response, payload } = await post(`/api/field/estimates/${estimate.id}/decline`);
      if (!response.ok) {
        throw new Error(String(payload.error ?? 'The estimate could not be declined.'));
      }
      setNotice({ kind: 'ok', message: `Declined. ${estimate.displayId} is closed.` });
      router.refresh();
    } catch (caught) {
      setNotice({ kind: 'error', message: caught instanceof Error ? caught.message : 'Declining failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    if (busy) return;
    setBusy('duplicate');
    setNotice(null);
    try {
      const { response, payload } = await post(`/api/field/estimates/${estimate.id}/duplicate`);
      if (!response.ok || !payload.estimate) {
        throw new Error(String(payload.error ?? 'The estimate could not be duplicated.'));
      }
      router.push(`/field/estimates/${(payload.estimate as { id: string }).id}`);
      router.refresh();
    } catch (caught) {
      setNotice({ kind: 'error', message: caught instanceof Error ? caught.message : 'Duplicating failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function sendToCustomer() {
    if (busy) return;
    setBusy('deliver');
    setNotice(null);
    try {
      let timeZone = 'America/New_York';
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || timeZone;
      } catch {
        // keep the default
      }
      const { response, payload } = await post(
        `/api/field/estimates/${estimate.id}/delivery`,
        { timeZone },
      );
      if (!response.ok) {
        const reason = typeof payload.reason === 'string' ? payload.reason : '';
        const friendly = DELIVERY_REASONS[reason];
        throw new Error(friendly || String(payload.error ?? 'Delivery could not be prepared.'));
      }
      const delivery = payload.delivery as { expiresAt?: string } | undefined;
      setDelivered(true);
      setNotice({
        kind: 'ok',
        message: delivery?.expiresAt
          ? `Customer link sent. It expires ${shortDate(delivery.expiresAt)}.`
          : 'Customer link sent.',
      });
    } catch (caught) {
      setNotice({ kind: 'error', message: caught instanceof Error ? caught.message : 'Delivery failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function revokeLinks() {
    if (busy) return;
    if (!window.confirm('Revoke all active customer links for this estimate?')) return;
    setBusy('revoke');
    setNotice(null);
    try {
      const response = await fetch(`/api/field/estimates/${estimate.id}/delivery`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'No active customer links were found.');
      }
      setDelivered(false);
      setNotice({ kind: 'ok', message: 'Active customer links were revoked.' });
    } catch (caught) {
      setNotice({ kind: 'error', message: caught instanceof Error ? caught.message : 'Revoking failed.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.actionBar}>
      {isDraft && canPrepare && (
        <Link className={styles.buttonGhost} href={`/field/estimates/${estimate.id}/edit`}>
          Edit
        </Link>
      )}

      {isDraft && canSend && (
        <button
          className={styles.buttonSecondary}
          disabled={busy !== null}
          type="button"
          onClick={sendToCustomer}
        >
          {busy === 'deliver' ? 'Sending…' : 'Send to customer'}
        </button>
      )}
      {delivered && isDraft && canSend && (
        <button
          className={styles.buttonDanger}
          disabled={busy !== null}
          type="button"
          onClick={revokeLinks}
        >
          Revoke links
        </button>
      )}

      {isDraft && canApprove && !signing && (
        <button
          className={styles.buttonSecondary}
          disabled={busy !== null}
          type="button"
          onClick={() => setSigning(true)}
        >
          Sign
        </button>
      )}
      {isDraft && canApprove && signing && (
        <>
          <input
            aria-label="Signer name"
            autoFocus
            className={styles.searchInput}
            maxLength={120}
            placeholder="Signer name"
            value={signerName}
            onChange={(event) => setSignerName(event.target.value)}
          />
          <button
            className={styles.button}
            disabled={busy !== null || !signerName.trim()}
            type="button"
            onClick={sign}
          >
            {busy === 'sign' ? 'Signing…' : 'Confirm sign'}
          </button>
          <button
            className={styles.buttonGhost}
            disabled={busy !== null}
            type="button"
            onClick={() => setSigning(false)}
          >
            Cancel
          </button>
        </>
      )}

      {isDraft && canPrepare && (
        <button
          className={styles.buttonDanger}
          disabled={busy !== null}
          type="button"
          onClick={decline}
        >
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </button>
      )}

      {!isDraft && canPrepare && (
        <button
          className={styles.buttonGhost}
          disabled={busy !== null}
          type="button"
          onClick={duplicate}
        >
          {busy === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
        </button>
      )}

      {notice && (
        <p className={notice.kind === 'ok' ? styles.alertOk : styles.alertError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.message}
        </p>
      )}
    </div>
  );
}
