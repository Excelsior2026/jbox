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
import NewEstimateButton from './new-estimate-button';
import styles from '../field.module.css';

export const dynamic = 'force-dynamic';

const STATUSES = new Set<EstimateStatus>(['draft', 'signed', 'declined']);

const STATUS_CLASS: Record<EstimateStatus, string> = {
  draft: styles.estimateStatus_draft,
  signed: styles.estimateStatus_signed,
  declined: styles.estimateStatus_declined,
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
        <NewEstimateButton />
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
          <div className={styles.estimateListEmpty}>
            <strong>No estimates yet</strong>
            <p>Start with an existing customer or add a new customer record.</p>
            <NewEstimateButton label="Create the first estimate" variant="plain" />
          </div>
        ) : (
          <div className={styles.estimateGrid}>
            {estimates.map((estimate) => (
              <Link className={styles.estimateCard} href={`/field/estimates/${estimate.id}`} key={estimate.id}>
                <div className={styles.estimateCardHeading}>
                  <span className={`${styles.estimateStatus} ${STATUS_CLASS[estimate.status]}`}>
                    {STATUS_LABELS[estimate.status]}
                  </span>
                  <time dateTime={estimate.updatedAt}>{dateTime(estimate.updatedAt)}</time>
                </div>
                <strong>{estimate.customerName}</strong>
                <p>{estimate.title || 'Project details not added'}</p>
                <div className={styles.estimateCardMeta}>
                  <span>{estimate.displayId}</span>
                  <span>{estimate.town || 'Town not added'}</span>
                  <strong>{money(estimate.totals.totalCents)}</strong>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
