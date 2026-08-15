import Link from 'next/link';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listCustomers } from '@/lib/customers';
import { dateTime } from '../format';
import styles from '../field.module.css';

export const dynamic = 'force-dynamic';

const MAX_SEARCH_LENGTH = 80;

type DirectoryProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function CustomerDirectory({ searchParams }: DirectoryProps) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'customers.read')) {
    return (
      <section className={styles.accessPanel}>
        <h1>No access to the customer directory.</h1>
        <p>Your staff role does not include customer directory access.</p>
      </section>
    );
  }

  const { q = '' } = await searchParams;
  const query = q.trim().slice(0, MAX_SEARCH_LENGTH);

  let customers: Awaited<ReturnType<typeof listCustomers>> = [];
  if (isDatabaseConfigured()) {
    customers = await withFieldContext(principal, () => listCustomers(query));
  }

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Directory</p>
          <h1 className={styles.pageTitle}>Customers</h1>
          <p className={styles.subtitle}>
            {customers.length} customer{customers.length === 1 ? '' : 's'}
            {query && <> matching “{query}”</>}
          </p>
        </div>
        <Link className={styles.button} href="/field/customers/new">New customer</Link>
      </header>

      <form className={styles.searchForm} method="get" action="/field/customers">
        <label htmlFor="customer-q" className={styles.hint}>Search</label>
        <input
          className={styles.searchInput}
          defaultValue={query}
          id="customer-q"
          maxLength={MAX_SEARCH_LENGTH}
          name="q"
          placeholder="Name, phone, email, or town"
          type="search"
        />
        <button className={styles.buttonGhost} type="submit">Search</button>
      </form>

      <div style={{ marginTop: '18px' }}>
        {customers.length === 0 ? (
          <div className={styles.estimateListEmpty}>
            <strong>{query ? 'No matching customers' : 'No customers yet'}</strong>
            <p>
              {query
                ? 'Try a different name, phone, email, address, or town.'
                : 'Add a customer or create an estimate from a service request.'}
            </p>
            <Link className={styles.button} href="/field/customers/new">New customer</Link>
          </div>
        ) : (
          <div className={styles.customerDirectoryGrid}>
            {customers.map((customer) => (
              <Link
                className={styles.customerDirectoryCard}
                href={`/field/customers/${customer.id}`}
                key={customer.id}
              >
                <div className={styles.customerDirectoryCardHeading}>
                  <span>{customer.displayId}</span>
                  <time dateTime={customer.updatedAt}>Updated {dateTime(customer.updatedAt)}</time>
                </div>
                <strong>{customer.name}</strong>
                <p>{[customer.address, customer.town].filter(Boolean).join(', ') || 'No service address on file'}</p>
                <div className={styles.customerDirectoryContact}>
                  <span>{customer.phone || 'No phone'}</span>
                  <span>{customer.email || 'No email'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
