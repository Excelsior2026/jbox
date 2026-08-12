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
          <div className={styles.empty}>
            <p>
              {query
                ? `No customers match “${query}”.`
                : 'No customers yet. Add the first one to start estimating.'}
            </p>
            <Link className={styles.button} href="/field/customers/new">New customer</Link>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Town</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link className={styles.rowLink} href={`/field/customers/${customer.id}`}>
                        {customer.name}
                      </Link>
                      <div className={styles.cellMuted}>{customer.displayId}</div>
                    </td>
                    <td>{customer.phone ?? <span className={styles.cellMuted}>—</span>}</td>
                    <td>{customer.email ?? <span className={styles.cellMuted}>—</span>}</td>
                    <td>{customer.town ?? <span className={styles.cellMuted}>—</span>}</td>
                    <td className={styles.cellMuted}>{dateTime(customer.updatedAt)}</td>
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
