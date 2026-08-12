import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getCustomer } from '@/lib/customers';
import { UUID_PATTERN } from '@/lib/ids';
import { dateTime } from '../../format';
import { CustomerForm } from '../customer-form';
import styles from '../../field.module.css';

export const dynamic = 'force-dynamic';

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

  const customer = await withFieldContext(principal, () => getCustomer(id));
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
      <div className={styles.empty}>
        <p>All estimates for this customer.</p>
        <Link className={styles.buttonGhost} href={`/field/estimates?customerId=${customer.id}`}>
          View estimates
        </Link>
      </div>
    </>
  );
}
