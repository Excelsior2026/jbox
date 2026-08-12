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
import { UUID_PATTERN } from '@/lib/ids';
import { dateTime, money, STATUS_LABELS } from '../format';
import styles from '../field.module.css';

export const dynamic = 'force-dynamic';

const STATUSES = new Set<EstimateStatus>(['draft', 'signed', 'declined']);

const STATUS_CLASS: Record<EstimateStatus, string> = {
  draft: styles.statusDraft,
  signed: styles.statusSigned,
  declined: styles.statusDeclined,
};

type EstimatesProps = {
  searchParams: Promise<{ status?: string; customerId?: string }>;
};

export default async function EstimatesList({ searchParams }: EstimatesProps) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return (
      <section className={styles.accessPanel}>
        <h1>No access to estimates.</h1>
        <p>Your staff role does not include estimate access.</p>
      </section>
    );
  }

  const params = await searchParams;
  const status = params.status && STATUSES.has(params.status as EstimateStatus)
    ? params.status as EstimateStatus
    : null;
  const customerId = params.customerId && UUID_PATTERN.test(params.customerId)
    ? params.customerId
    : null;

  let estimates: Awaited<ReturnType<typeof listEstimates>> = [];
  let customers: Awaited<ReturnType<typeof listCustomers>> = [];
  if (isDatabaseConfigured()) {
    [estimates, customers] = await withFieldContext(principal, async () => Promise.all([
      listEstimates({ status: status ?? undefined, customerId: customerId ?? undefined }),
      listCustomers(''),
    ]));
  }

  const selectedCustomer = customerId
    ? customers.find((c) => c.id === customerId)
    : undefined;

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Estimates</p>
          <h1 className={styles.pageTitle}>Estimates</h1>
          <p className={styles.subtitle}>
            {estimates.length} estimate{estimates.length === 1 ? '' : 's'}
            {status && <> · {STATUS_LABELS[status].toLowerCase()}</>}
            {selectedCustomer && <> · {selectedCustomer.name}</>}
          </p>
        </div>
        <Link className={styles.button} href="/field/estimates/new">New estimate</Link>
      </header>

      <form className={styles.searchForm} method="get" action="/field/estimates">
        {customerId && <input name="customerId" type="hidden" value={customerId} />}
        <label htmlFor="estimate-status" className={styles.hint}>Status</label>
        <select
          className={styles.lineInput}
          defaultValue={status ?? ''}
          id="estimate-status"
          name="status"
          style={{ width: 'auto' }}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="signed">Signed</option>
          <option value="declined">Declined</option>
        </select>
        <button className={styles.buttonGhost} type="submit">Filter</button>
        {(status || customerId) && (
          <Link className={styles.buttonGhost} href="/field/estimates">Clear filters</Link>
        )}
      </form>

      <div style={{ marginTop: '18px' }}>
        {estimates.length === 0 ? (
          <div className={styles.empty}>
            <p>No estimates match these filters.</p>
            <Link className={styles.button} href="/field/estimates/new">New estimate</Link>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Estimate</th>
                  <th>Customer</th>
                  <th>Town</th>
                  <th>Status</th>
                  <th className={styles.amount}>Total</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((estimate) => (
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
                    <td>{estimate.town || <span className={styles.cellMuted}>—</span>}</td>
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
      </div>
    </>
  );
}
