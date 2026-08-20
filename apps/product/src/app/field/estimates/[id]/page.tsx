import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getEstimate } from '@/lib/estimates';
import type { EstimateRecord } from '@/lib/estimate-record';
import { UUID_PATTERN } from '@/lib/ids';
import { dateTime, money, percent, quantity, STATUS_LABELS } from '../../format';
import { EstimateActions } from '../estimate-actions';
import styles from '../../field.module.css';

export const dynamic = 'force-dynamic';

type EstimateDetailProps = {
  params: Promise<{ id: string }>;
};

const STATUS_CLASS: Record<EstimateRecord['status'], string> = {
  draft: styles.statusDraft,
  signed: styles.statusSigned,
  declined: styles.statusDeclined,
};

export default async function EstimateDetail({ params }: EstimateDetailProps) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    notFound();
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  if (!isDatabaseConfigured()) notFound();

  const estimate = await withFieldContext(principal, () => getEstimate(id));
  if (!estimate) notFound();

  const canPrepare = fieldPrincipalCan(principal, 'estimates.prepare');
  const canApprove = fieldPrincipalCan(principal, 'estimates.approve');
  const canSend = fieldPrincipalCan(principal, 'estimates.send');

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{estimate.displayId}</p>
          <h1 className={styles.pageTitle}>{estimate.title}</h1>
          <p className={styles.subtitle}>
            <span className={`${styles.badge} ${STATUS_CLASS[estimate.status]}`}>
              {STATUS_LABELS[estimate.status]}
            </span>
          </p>
        </div>
        <Link className={styles.buttonGhost} href="/field/estimates">Back to estimates</Link>
      </header>

      <EstimateActions
        canApprove={canApprove}
        canPrepare={canPrepare}
        canSend={canSend}
        estimate={estimate}
      />

      <article className={styles.document}>
        <header className={styles.documentHeader}>
          <div>
            <p className={styles.eyebrow}>Prepared for</p>
            <strong>{estimate.customer.name}</strong>
            <p className={styles.meta}>
              {[estimate.customer.address, estimate.customer.town].filter(Boolean).join(', ') ||
                'No address on file'}
            </p>
          </div>
          <dl className={styles.meta}>
            <p>
              Customer:{' '}
              <Link className={styles.rowLink} href={`/field/customers/${estimate.customerId}`}>
                view
              </Link>
            </p>
            <p>Issued {dateTime(estimate.createdAt)}</p>
            <p>Updated {dateTime(estimate.updatedAt)}</p>
            {estimate.signedAt && <p>Signed {dateTime(estimate.signedAt)} by {estimate.signedByName ?? 'unknown'}</p>}
            {estimate.declinedAt && <p>Declined {dateTime(estimate.declinedAt)}</p>}
          </dl>
        </header>

        <div className={styles.documentBody}>
          {estimate.scope && (
            <div>
              <p className={styles.eyebrow}>Scope of work</p>
              <p className={styles.meta} style={{ whiteSpace: 'pre-wrap' }}>{estimate.scope}</p>
            </div>
          )}
          {estimate.exclusions && (
            <div>
              <p className={styles.eyebrow}>Exclusions</p>
              <p className={styles.meta} style={{ whiteSpace: 'pre-wrap' }}>{estimate.exclusions}</p>
            </div>
          )}

          <div>
            <p className={styles.eyebrow}>Scope of Work & Fixed Estimate</p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Labor & Field Operations</th>
                    <th className={styles.amount}>Qty</th>
                    <th className={styles.amount}>Unit price</th>
                    <th className={styles.amount}>Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.lineItems.map((line) => (
                    <tr key={line.id}>
                      <td>
                        {line.description}
                        {line.itemCode && <div className={styles.cellMuted}>{line.itemCode}</div>}
                      </td>
                      <td className={styles.amount}>{quantity(line.quantityHundredths)}</td>
                      <td className={styles.amount}>{money(line.unitPriceCents)}</td>
                      <td className={styles.amount}>{money(line.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.totals}>
            <div className={styles.totalsRow}><span>Subtotal</span><span>{money(estimate.totals.subtotalCents)}</span></div>
            {estimate.totals.discountCents > 0 && (
              <div className={styles.totalsRow}>
                <span>Discount ({percent(estimate.discountMillipercent)})</span>
                <span>-{money(estimate.totals.discountCents)}</span>
              </div>
            )}
            {estimate.surchargeCents > 0 && (
              <div className={styles.totalsRow}><span>Surcharge</span><span>{money(estimate.surchargeCents)}</span></div>
            )}
            <div className={styles.totalsRow}>
              <span>Tax ({percent(estimate.taxRateMillipercent)})</span>
              <span>{money(estimate.totals.taxCents)}</span>
            </div>
            <div className={styles.totalsRowTotal}><span>Total</span><span>{money(estimate.totals.totalCents)}</span></div>
            {estimate.depositCents > 0 && (
              <div className={styles.totalsRow}><span>Deposit</span><span>{money(estimate.depositCents)}</span></div>
            )}
          </div>

          {estimate.notes && (
            <div>
              <p className={styles.eyebrow}>Notes</p>
              <p className={styles.meta} style={{ whiteSpace: 'pre-wrap' }}>{estimate.notes}</p>
            </div>
          )}
        </div>

        <footer className={styles.documentFooter}>
          <span>{estimate.customer.phone || 'No phone on file'}</span>
          <span>{estimate.customer.email || 'No email on file'}</span>
        </footer>
      </article>
    </>
  );
}
