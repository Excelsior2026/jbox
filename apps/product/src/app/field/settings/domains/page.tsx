import type { Metadata } from 'next';
import { getFieldPrincipal } from '@/lib/field-api-auth';
import { isFieldAuthConfigured } from '@/lib/identity-environment';
import { db, isDatabaseConfigured } from '@/lib/db';
import styles from '../field.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Domains — J-Box Field',
  description: 'Manage your custom domains for the J-Box storefront.',
  robots: { index: false, follow: false },
};

type DomainRecord = {
  id: string;
  hostname: string;
  isCanonical: boolean;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
};

async function getDomains(): Promise<DomainRecord[]> {
  const principal = await getFieldPrincipal();
  if (!principal) return [];
  if (!isDatabaseConfigured()) return [];

  try {
    const sql = db();
    const rows = await sql.query(
      `SELECT id, hostname, is_canonical, verified, verified_at, created_at
       FROM organization_domains
       ORDER BY is_canonical DESC, created_at ASC`,
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      hostname: String(row.hostname),
      isCanonical: Boolean(row.is_canonical),
      verified: Boolean(row.verified),
      verifiedAt: row.verified_at ? String(row.verified_at) : null,
      createdAt: String(row.created_at),
    }));
  } catch {
    return [];
  }
}

export default async function DomainsPage() {
  const principal = await getFieldPrincipal();

  if (!principal) {
    if (isFieldAuthConfigured()) {
      return (
        <main className={styles.accessPage}>
          <section className={styles.accessPanel}>
            <p className={styles.eyebrow}>J-Box Field</p>
            <h1>Sign in to manage domains.</h1>
            <p>You need to sign in to access domain settings.</p>
          </section>
        </main>
      );
    }

    return (
      <main className={styles.accessPage}>
        <section className={styles.accessPanel}>
          <p className={styles.eyebrow}>J-Box Field</p>
          <h1>Staff access is not configured.</h1>
          <p>No identity provider is configured for this deployment yet.</p>
        </section>
      </main>
    );
  }

  const domains = await getDomains();
  const canonicalDomain = domains.find((d) => d.isCanonical);
  const customDomains = domains.filter((d) => !d.isCanonical);

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Settings</p>
          <h1 className={styles.pageTitle}>Domains</h1>
          <p className={styles.subtitle}>
            Manage your storefront domains. Your canonical domain is used for
            customer-facing links and emails.
          </p>
        </div>
      </div>

      {/* Canonical Domain */}
      <section style={{ marginBottom: 32 }}>
        <h2 className={styles.sectionTitle}>Canonical Domain</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 0, marginBottom: 16 }}>
          This is your default domain provided by J-Box. Customer-facing links
          (estimates, invoices) use this domain.
        </p>
        {canonicalDomain ? (
          <div className={styles.card} style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '1.1rem' }}>{canonicalDomain.hostname}</strong>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>
                  {canonicalDomain.verified ? 'Verified' : 'Pending verification'}
                </p>
              </div>
              <span
                className={`${styles.badge} ${canonicalDomain.verified ? styles.statusSigned : styles.statusDraft}`}
              >
                {canonicalDomain.verified ? 'Active' : 'Pending'}
              </span>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No canonical domain found.</p>
        )}
      </section>

      {/* Custom Domains */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Custom Domains</h2>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: 0, marginBottom: 16 }}>
          Point your own domain to J-Box. You&apos;ll need to add a CNAME record
          pointing to <code>cname.vercel-dns.com</code>.
        </p>

        {customDomains.length === 0 ? (
          <div className={styles.empty}>
            <p>No custom domains configured yet.</p>
            <p style={{ fontSize: '0.85rem' }}>
              Add your business domain (e.g., smithplumbing.com) to use it
              instead of the default J-Box subdomain.
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customDomains.map((domain) => (
                  <tr key={domain.id}>
                    <td>
                      <strong>{domain.hostname}</strong>
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${domain.verified ? styles.statusSigned : styles.statusDraft}`}
                      >
                        {domain.verified ? 'Verified' : 'Pending'}
                      </span>
                    </td>
                    <td className={styles.cellMuted}>
                      {new Date(domain.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!domain.verified && (
                        <form
                          action={`/api/field/domains/${domain.id}/verify`}
                          method="post"
                          style={{ display: 'inline' }}
                        >
                          <button
                            type="submit"
                            className={`${styles.button} ${styles.buttonSmall}`}
                          >
                            Verify
                          </button>
                        </form>
                      )}
                      <form
                        action={`/api/field/domains/${domain.id}`}
                        method="delete"
                        style={{ display: 'inline', marginLeft: 8 }}
                      >
                        <button
                          type="submit"
                          className={`${styles.buttonDanger} ${styles.buttonSmall}`}
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Domain Form */}
        <div style={{ marginTop: 24, maxWidth: 480 }}>
          <h3 className={styles.sectionTitle}>Add Custom Domain</h3>
          <form
            action="/api/field/domains"
            method="post"
            className={styles.form}
          >
            <div className={styles.field}>
              <label htmlFor="hostname">Domain Name</label>
              <input
                type="text"
                id="hostname"
                name="hostname"
                placeholder="smithplumbing.com"
                required
                pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*"
              />
              <span className={styles.hint}>
                Enter your domain without http:// or www.
              </span>
            </div>
            <div className={styles.formActions}>
              <button type="submit" className={styles.button}>
                Add Domain
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* DNS Instructions */}
      <section style={{ marginTop: 40 }}>
        <h2 className={styles.sectionTitle}>DNS Setup Instructions</h2>
        <div className={styles.card} style={{ maxWidth: 640 }}>
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            To use a custom domain, add a <strong>CNAME record</strong> in your
            DNS settings:
          </p>
          <div style={{
            background: '#f9fafb',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
          }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: 'var(--muted)' }}>Host:</span>{' '}
              <code>@</code> or <code>www</code>
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: 'var(--muted)' }}>Type:</span>{' '}
              <code>CNAME</code>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>Value:</span>{' '}
              <code>cname.vercel-dns.com</code>
            </div>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 12, marginBottom: 0 }}>
            DNS propagation can take up to 48 hours. Once verified, your domain
            will be active automatically.
          </p>
        </div>
      </section>
    </div>
  );
}
