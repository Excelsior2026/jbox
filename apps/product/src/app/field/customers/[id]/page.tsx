import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getCustomer } from '@/lib/customers';
import { listEstimates } from '@/lib/estimates';
import type { EstimateStatus } from '@/lib/estimate-contract';
import { UUID_PATTERN } from '@/lib/ids';
import { dateTime, money, STATUS_LABELS } from '../../format';
import { CustomerForm } from '../customer-form';
import styles from '../../field.module.css';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<EstimateStatus, string> = {
  draft: styles.statusDraft,
  signed: styles.statusSigned,
  declined: styles.statusDeclined,
};

type CustomerDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function CustomerDetail({ params }: CustomerDetailProps) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'customers.read')) {
    notFound();
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  if (!isDatabaseConfigured()) {
    notFound();
  }

  const [customer, estimates] = await withFieldContext(principal, async () => Promise.all([
    getCustomer(id),
    fieldPrincipalCan(principal, 'estimates.read') ? listEstimates({ customerId: id }) : Promise.resolve([]),
  ]));
  if (!customer) notFound();

  const canEstimate = fieldPrincipalCan(principal, 'estimates.prepare');

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{customer.displayId}</p>
          <h1 className={styles.pageTitle}>{customer.name}</h1>
          <p className={styles.subtitle}>Updated {dateTime(customer.updatedAt)}</p>
        </div>
        <div className={styles.actionBar}>
          <Link className={styles.buttonGhost} href="/field/customers">Back to directory</Link>
          {canEstimate && (
            <Link className={styles.button} href={`/field/estimates/new?customerId=${customer.id}`}>
              New estimate for this customer
            </Link>
          )}
        </div>
      </header>

      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Phone</p>
          <span>{customer.phone ?? '—'}</span>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Email</p>
          <span>{customer.email ?? '—'}</span>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Address</p>
          <span>{[customer.address, customer.town].filter(Boolean).join(', ') || '—'}</span>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Edit customer</h2>
      <CustomerForm mode="edit" initial={customer} />

      <h2 className={styles.sectionTitle} style={{ marginTop: '28px' }}>Estimates</h2>
      {estimates.length === 0 ? (
        <div className={styles.empty}>
          <p>No estimates for this customer yet.</p>
          {canEstimate && (
            <Link className={styles.button} href={`/field/estimates/new?customerId=${customer.id}`}>
              Start an estimate
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Estimate</th>
                  <th>Status</th>
                  <th className={styles.amount}>Total</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {estimates.slice(0, 8).map((estimate) => (
                  <tr key={estimate.id}>
                    <td>
                      <Link className={styles.rowLink} href={`/field/estimates/${estimate.id}`}>
                        {estimate.displayId}
                      </Link>
                      <div className={styles.cellMuted}>{estimate.title}</div>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${STATUS_CLASS[estimate.status]}`}>
                        {STATUS_LABELS[estimate.status]}
                      </span>
                    </td>
                    <td className={styles.amount}>{money(estimate.totals.totalCents)}</td>
                    <td className={styles.cellMuted}>{dateTime(estimate.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {estimates.length > 8 && (
            <Link className={styles.buttonGhost} href={`/field/estimates?customerId=${customer.id}`} style={{ marginTop: '14px' }}>
              View all {estimates.length} estimates
            </Link>
          )}
        </>
      )}
    </>
  );
}
