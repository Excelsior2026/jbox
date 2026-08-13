import type { Metadata } from 'next';
import Link from 'next/link';
import { SignOutButton } from '@clerk/nextjs';
import { getFieldPrincipal } from '@/lib/field-api-auth';
import { isClerkIdentityConfigured } from '@/lib/identity-environment';
import styles from './field.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box Field',
  description: 'Staff workspace for trade contractors. A J-Box product.',
  robots: { index: false, follow: false },
};

/**
 * Field shell. Runs on the platform host (field.usejbox.com): tenant-free by
 * construction. Every request resolves its own principal — Clerk session when
 * identity is configured, otherwise the development owner fallback — and the
 * pages under it do their own two-phase resolve-then-withFieldContext work.
 * With no principal there is nothing to render, so the shell fails closed to a
 * neutral access panel rather than a half-authenticated page. A development
 * principal carries a demo banner so the open workspace cannot be mistaken for
 * an authenticated production one.
 */
export default async function FieldLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const principal = await getFieldPrincipal();

  if (!principal) {
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
            {isClerkIdentityConfigured() && <SignOutButton redirectUrl="/" />}
          </div>
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.contentInner}>{children}</div>
      </main>
    </div>
  );
}
