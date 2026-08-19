import type { Metadata } from 'next';
import Link from 'next/link';
import { getFieldPrincipal } from '@/lib/field-api-auth';
import { isFieldAuthConfigured } from '@/lib/identity-environment';
import { ROLE_LABELS } from '@/lib/identity';
import { platformDb, isDatabaseConfigured } from '@/lib/db';
import { MobileMenuButton } from './mobile-menu-button';
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
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Reads the subscription status for the given organization. Returns null when
 * the database is not configured (dev mode). A non-active status means the
 * tenant's trial has expired or they have canceled.
 */
async function getSubscriptionStatus(organizationId: string): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    // platform_runtime has no direct SELECT on organizations. Use the
    // SECURITY DEFINER window from migration 014 instead.
    const rows = await platformDb().query(
      'SELECT subscription_status FROM resolve_organization_subscription($1)',
      [organizationId],
    ) as Array<{ subscription_status: string }>;
    return rows[0]?.subscription_status ?? null;
  } catch {
    return null;
  }
}

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

  // Subscription gate — show a warning banner when past_due / canceled but
  // still let the user access the workspace so they can manage billing.
  let subscriptionStatus: string | null = null;
  if (principal.kind === 'jwt') {
    subscriptionStatus = await getSubscriptionStatus(principal.organizationId);
  }
  const subscriptionBlocked = subscriptionStatus !== null
    && !ACTIVE_STATUSES.has(subscriptionStatus);

  return (
    <div className={styles.shell}>
      {principal.kind === 'development' && (
        <div className={styles.demoBanner} role="note">
          Demo mode — you are exploring as an owner of the demo organization.
          Anyone with this link can view and change this workspace.
        </div>
      )}
      {subscriptionBlocked && (
        <div role="alert" style={{
          background: '#fef9c3', color: '#713f12', borderBottom: '1px solid #fde047',
          padding: '10px 24px', textAlign: 'center', fontSize: '0.88rem',
        }}>
          <strong>Subscription {subscriptionStatus}.</strong>{' '}
          To keep using J-Box Field, please{' '}
          <a href="/api/platform/billing/portal-redirect" style={{ color: '#713f12', fontWeight: 700 }}>
            update your billing
          </a>.
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <MobileMenuButton />
          <Link className={styles.brand} href="/field">J-Box Field</Link>
          <nav className={styles.nav} aria-label="Field workspace">
            <Link className={styles.navLink} href="/field">Dashboard</Link>
            <Link className={styles.navLink} href="/field/customers">Customers</Link>
            <Link className={styles.navLink} href="/field/estimates">Estimates</Link>
            <Link className={styles.navLink} href="/field/invoices">Invoices</Link>
            {principal.role === 'owner' && (
              <Link className={styles.navLink} href="/field/settings/domains">Domains</Link>
            )}
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
                {principal.role === 'owner' && subscriptionStatus && (
                  <form action="/api/platform/billing/portal-redirect" method="post">
                    <button className={styles.buttonGhost} type="submit" style={{ fontSize: '0.8rem' }}>
                      Billing
                    </button>
                  </form>
                )}
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
