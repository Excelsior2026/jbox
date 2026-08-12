import Link from 'next/link';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listEstimates } from '@/lib/estimates';
import { listCustomers } from '@/lib/customers';
import type { EstimateStatus } from '@/lib/estimate-contract';
import { dateTime, money, STATUS_LABELS } from './format';
import styles from './field.module.css';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 6;

const STATUS_CLASS: Record<EstimateStatus, string> = {
  draft: styles.statusDraft,
  signed: styles.statusSigned,
  declined: styles.statusDeclined,
};

export default async function FieldDashboard() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return (
      <section className={styles.accessPanel}>
        <h1>No Field access.</h1>
        <p>Your staff role does not include access to this workspace.</p>
      </section>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div className={styles.empty}>
        <p>The workspace database is not configured yet.</p>
      </div>
    );
  }

  const { estimates, customers } = await withFieldContext(principal, async () => {
    const [allEstimates, allCustomers] = await Promise.all([
      listEstimates(),
      listCustomers(''),
    ]);
    return { estimates: allEstimates, customers: allCustomers };
  });

  const recent = estimates.slice(0, RECENT_LIMIT);
  const signedCount = estimates.filter((e) => e.status === 'signed').length;

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1 className={styles.pageTitle}>Dashboard</h1>
          <p className={styles.subtitle}>
            {customers.length} customer{customers.length === 1 ? '' : 's'} ·{' '}
            {estimates.length} estimate{estimates.length === 1 ? '' : 's'} in this organization
          </p>
        </div>
        <div className={styles.actionBar}>
          <Link className={styles.buttonSecondary} href="/field/customers/new">New customer</Link>
          <Link className={styles.button} href="/field/estimates/new">New estimate</Link>
        </div>
      </header>

      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Customers</p>
          <span className={styles.statValue}>{customers.length}</span>
          <p className={styles.statNote}>In the directory</p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Draft estimates</p>
          <span className={styles.statValue}>{estimates.length - signedCount}</span>
          <p className={styles.statNote}>Open and being prepared</p>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Signed estimates</p>
          <span className={styles.statValue}>{signedCount}</span>
          <p className={styles.statNote}>Accepted by customers</p>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Recent estimates</h2>
      {recent.length === 0 ? (
        <div className={styles.empty}>
          <p>No estimates yet. Create the first one to start pricing work.</p>
          <Link className={styles.button} href="/field/estimates/new">New estimate</Link>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Estimate</th>
                <th>Customer</th>
                <th>Status</th>
                <th className={styles.amount}>Total</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((estimate) => (
                <tr key={estimate.id}>
                  <td>
                    <Link className={styles.rowLink} href={`/field/estimates/${estimate.id}`}>
                      {estimate.displayId}
                    </Link>
                    <div className={styles.cellMuted}>{estimate.title}</div>
                  </td>
                  <td>
                    <Link className={styles.rowLink} href={`/field/customers/${estimate.customerId}`}>
                      {estimate.customerName}
                    </Link>
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
      )}
    </>
  );
}
