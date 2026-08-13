import type { Metadata } from 'next';
import Link from 'next/link';
import { getFieldPrincipal } from '@/lib/field-api-auth';
import { isFieldAuthConfigured } from '@/lib/identity-environment';
import { ROLE_LABELS } from '@/lib/identity';
import styles from './field.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box Field',
  description: 'Staff workspace for trade contractors. A J-Box product.',
  robots: { index: false, follow: false },
};

/**
 * Field shell. Runs on the platform host (field.usejbox.com): tenant-free by
 * construction. Every request resolves its own principal — a first-party
 * session JWT when the staff member has signed in, otherwise the development
 * owner fallback in demo mode — and the pages under it do their own two-phase
 * resolve-then-withFieldContext work.
 *
 * With no principal there is nothing to render, so the shell fails closed to
 * the sign-in page when auth is configured, or a neutral access panel when no
 * identity provider is configured at all. A development principal carries a
 * demo banner so the open workspace cannot be mistaken for an authenticated
 * production one.
 */
export default async function FieldLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const principal = await getFieldPrincipal();

  if (!principal) {
    if (isFieldAuthConfigured()) {
      return (
        <main className={styles.accessPage}>
          <section className={styles.accessPanel}>
            <p className={styles.eyebrow}>J-Box Field</p>
            <h1>Sign in to the workspace.</h1>
            <p>
              The Field workspace resolves an authenticated staff member and
              their active organization. Sign in to continue.
            </p>
            <Link className={styles.button} href="/field/login">Sign in</Link>
          </section>
        </main>
      );
    }

    return (
      <main className={styles.accessPage}>
        <section className={styles.accessPanel}>
          <p className={styles.eyebrow}>J-Box Field</p>
          <h1>Staff access is not configured.</h1>
          <p>
            The Field workspace resolves an authenticated staff member and their
            active organization. No identity provider is configured for this
            deployment yet.
          </p>
          <Link className={styles.buttonSecondary} href="/">Return to the platform</Link>
        </section>
      </main>
    );
  }

  return (
    <div className={styles.shell}>
      {principal.kind === 'development' && (
        <div className={styles.demoBanner} role="note">
          Demo mode — you are exploring as an owner of the demo organization.
          Anyone with this link can view and change this workspace.
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/field">J-Box Field</Link>
          <nav className={styles.nav} aria-label="Field workspace">
            <Link className={styles.navLink} href="/field">Dashboard</Link>
            <Link className={styles.navLink} href="/field/customers">Customers</Link>
            <Link className={styles.navLink} href="/field/estimates">Estimates</Link>
          </nav>
          <div className={styles.headerActions}>
            {principal.kind === 'jwt' ? (
              <>
                <span className={styles.identity}>
                  {principal.displayName ?? principal.email}
                  <span className={styles.identityMeta}>
                    {ROLE_LABELS[principal.role]}
                  </span>
                </span>
                <form action="/api/auth/logout" method="post">
                  <button className={styles.buttonGhost} type="submit">Sign out</button>
                </form>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.contentInner}>{children}</div>
      </main>
    </div>
  );
}
