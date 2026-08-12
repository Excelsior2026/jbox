import Link from 'next/link';
import { CustomerForm } from '../customer-form';
import styles from '../../field.module.css';

export const dynamic = 'force-dynamic';

export default function NewCustomerPage() {
  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Directory</p>
          <h1 className={styles.pageTitle}>New customer</h1>
          <p className={styles.subtitle}>Only the name is required; the rest can be filled in later.</p>
        </div>
        <Link className={styles.buttonGhost} href="/field/customers">Back to directory</Link>
      </header>
      <CustomerForm mode="create" />
    </>
  );
}
