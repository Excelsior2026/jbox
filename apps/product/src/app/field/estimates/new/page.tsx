import Link from 'next/link';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getCustomer } from '@/lib/customers';
import { UUID_PATTERN } from '@/lib/ids';
import { EstimateEditor } from '../estimate-editor';
import styles from '../../field.module.css';

export const dynamic = 'force-dynamic';

type NewEstimateProps = {
  searchParams: Promise<{ customerId?: string }>;
};

export default async function NewEstimate({ searchParams }: NewEstimateProps) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return (
      <section className={styles.accessPanel}>
        <h1>No access to prepare estimates.</h1>
        <p>Your staff role does not include estimate preparation.</p>
      </section>
    );
  }

  const { customerId } = await searchParams;
  let customer: Awaited<ReturnType<typeof getCustomer>> | null = null;
  if (
    customerId
    && UUID_PATTERN.test(customerId)
    && fieldPrincipalCan(principal, 'customers.read')
    && isDatabaseConfigured()
  ) {
    customer = await withFieldContext(principal, () => getCustomer(customerId));
  }

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Estimates</p>
          <h1 className={styles.pageTitle}>New estimate</h1>
          <p className={styles.subtitle}>
            {customer
              ? `Preparing an estimate for ${customer.name}.`
              : 'Pricing is recorded exactly as entered.'}
          </p>
        </div>
        <Link className={styles.buttonGhost} href="/field/estimates">Back to estimates</Link>
      </header>

      <EstimateEditor
        customer={customer ?? undefined}
        customerId={customer?.id}
        mode="create"
      />
    </>
  );
}
