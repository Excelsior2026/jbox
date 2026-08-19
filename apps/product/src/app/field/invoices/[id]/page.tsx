import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { UUID_PATTERN } from '@/lib/ids';
import { getInvoice, getInvoiceLines, type InvoiceLineRecord } from '@/lib/invoices';
import type { InvoiceRecord } from '@/lib/invoice-record';
import { invoiceStatusLabel } from '@/lib/invoice-contract';
import { dateTime, money, quantity } from '../../format';
import styles from '../../field.module.css';

export const dynamic = 'force-dynamic';

type InvoiceDetailProps = {
  params: Promise<{ id: string }>;
};

const STATUS_CLASS: Record<InvoiceRecord['status'], string> = {
  draft: styles.statusDraft,
  issued: styles.statusSigned,
  partially_paid: styles.statusSigned,
  paid: styles.statusSigned,
  cancelled: styles.statusDeclined,
};

function LineRows({ lines }: { lines: InvoiceLineRecord[] }) {
  if (!lines.length) {
    return <p className={styles.invoiceEmptyState}>This invoice has no line items.</p>;
  }
  return (
    <ol className={styles.invoiceLines}>
      {lines.map((line) => (
        <li key={line.id} className={styles.invoiceLine}>
          <span className={styles.invoiceLineQty}>
            {quantity(line.quantityHundredths)}×
          </span>
          <span className={styles.invoiceLineDescription}>
            <strong>{line.description}</strong>
            <small>{line.itemCode}</small>
          </span>
          <span className={styles.invoiceLinePrice}>{money(line.lineTotalCents)}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function InvoiceDetail({ params }: InvoiceDetailProps) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'invoices.read')) {
    notFound();
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  if (!isDatabaseConfigured()) notFound();

  const invoice = await withFieldContext(principal, () => getInvoice(id));
  if (!invoice) notFound();

  const lines = await withFieldContext(principal, () => getInvoiceLines(id));

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{invoice.displayId}</p>
          <h1 className={styles.pageTitle}>{invoice.title}</h1>
          <p className={styles.subtitle}>
            <span className={`${styles.badge} ${STATUS_CLASS[invoice.status]}`}>
              {invoiceStatusLabel(invoice.status)}
            </span>
            <span>{invoice.customerName}</span>
            {invoice.dueAt && <span>Due {dateTime(invoice.dueAt)}</span>}
          </p>
        </div>
        <Link className={styles.buttonGhost} href="/field/estimates">Back to estimates</Link>
      </header>

      <section className={styles.invoiceDetailCard} aria-label="Invoice details">
        <div className={styles.invoiceDetailGrid}>
          <div>
            <span>Created</span>
            <strong>{dateTime(invoice.createdAt)}</strong>
          </div>
          {invoice.estimateId && (
            <div>
              <span>From estimate</span>
              <strong>
                <Link href={`/field/estimates/${invoice.estimateId}`}>View estimate</Link>
              </strong>
            </div>
          )}
          {invoice.jobId && (
            <div>
              <span>Job</span>
              <strong>{invoice.jobId}</strong>
            </div>
          )}
          <div>
            <span>Subtotal</span>
            <strong>{money(invoice.totals.subtotalCents)}</strong>
          </div>
          {invoice.totals.taxCents > 0 && (
            <div>
              <span>Tax</span>
              <strong>{money(invoice.totals.taxCents)}</strong>
            </div>
          )}
          <div>
            <span>Total</span>
            <strong>{money(invoice.totals.totalCents)}</strong>
          </div>
        </div>
      </section>

      <section className={styles.invoiceDetailCard} aria-label="Line items">
        <h2 className={styles.invoiceCardTitle}>Line items</h2>
        <LineRows lines={lines} />
      </section>
    </>
  );
}
