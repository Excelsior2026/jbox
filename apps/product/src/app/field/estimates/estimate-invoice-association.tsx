'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { EstimateStatus } from '@/lib/estimate-contract';
import type { InvoiceRecord, InvoiceSummary } from '@/lib/invoice-record';
import styles from '../field.module.css';

type ApiPayload = {
  invoices?: InvoiceSummary[];
  invoice?: InvoiceRecord | InvoiceSummary;
  error?: string;
};

type Props = {
  estimateId: string;
  estimateStatus: EstimateStatus;
  jobId: string | null;
  expectedUpdatedAt: string;
  onInvoiceCreated?: (invoice: InvoiceRecord | InvoiceSummary) => void;
};

async function responsePayload(response: Response): Promise<ApiPayload> {
  try {
    return await response.json() as ApiPayload;
  } catch {
    return {};
  }
}

export default function EstimateInvoiceAssociation({
  estimateId,
  estimateStatus,
  jobId,
  expectedUpdatedAt,
  onInvoiceCreated,
}: Props) {
  const [invoice, setInvoice] = useState<InvoiceSummary | InvoiceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadInvoice() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ estimateId });
        const response = await fetch(`/api/field/invoices?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const payload = await responsePayload(response);
        if (!response.ok || !Array.isArray(payload.invoices)) {
          throw new Error(payload.error || 'Invoice status could not be loaded.');
        }
        if (!controller.signal.aborted) setInvoice(payload.invoices[0] ?? null);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error
          ? requestError.message
          : 'Invoice status could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadInvoice();
    return () => controller.abort();
  }, [estimateId]);

  async function createInvoice() {
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/field/invoices', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimateId, expectedUpdatedAt }),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.invoice) {
        throw new Error(payload.error || 'The internal invoice draft could not be created.');
      }
      setInvoice(payload.invoice);
      onInvoiceCreated?.(payload.invoice);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'The internal invoice draft could not be created.');
    } finally {
      setCreating(false);
    }
  }

  const eligible = estimateStatus === 'signed' && Boolean(jobId);
  const reason = estimateStatus !== 'signed'
    ? 'A signed estimate is required before invoice conversion.'
    : !jobId
      ? 'Link this signed estimate to a job before invoice conversion.'
      : 'Ready to freeze this signed estimate into an internal invoice draft.';

  return (
    <section className={styles.estimateInvoiceAssociation} aria-label="Internal invoice">
      <div>
        <span>Internal billing</span>
        <strong>{invoice ? `Invoice ${invoice.displayId}` : loading ? 'Checking invoice…' : 'No invoice created'}</strong>
        <p>{invoice
          ? 'Frozen internal record. Customer delivery and payment processing are not connected.'
          : reason}</p>
        {error && <small role="alert">{error}</small>}
      </div>
      {invoice ? (
        <Link href={`/field/invoices/${invoice.id}`}>Open invoice</Link>
      ) : (
        <button
          type="button"
          disabled={!eligible || loading || creating || !expectedUpdatedAt}
          onClick={() => void createInvoice()}
        >
          {creating ? 'Creating…' : 'Create internal draft'}
        </button>
      )}
    </section>
  );
}
