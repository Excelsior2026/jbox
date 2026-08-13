import Link from 'next/link';
import { LoginForm } from '../login-form';
import styles from '../field.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Field sign-in. Rendered by the Field shell when a request has no principal
 * and auth is configured (see field/layout.tsx). The form posts to the login
 * API, which sets the HttpOnly session cookie.
 */
export default async function FieldLoginPage() {
  return (
    <main className={styles.accessPage}>
      <section className={styles.accessPanel}>
        <p className={styles.eyebrow}>J-Box Field</p>
        <h1>Sign in</h1>
        <p>Staff workspace for trade contractors.</p>
        <LoginForm />
        <p className={styles.accessMuted}>
          <Link href="/">Return to the platform</Link>
        </p>
      </section>
    </main>
  );
}
