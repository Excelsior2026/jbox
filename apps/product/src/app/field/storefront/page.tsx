import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { formatCents, loadInForceConfig } from '@/lib/tenant';
import styles from '../field.module.css';

export const dynamic = 'force-dynamic';

export default async function StorefrontPreview() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    notFound();
  }

  if (!isDatabaseConfigured()) notFound();

  const config = await withFieldContext(principal, () => loadInForceConfig());
  if (!config) notFound();

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Storefront</p>
          <h1 className={styles.pageTitle}>Storefront Preview</h1>
          <p className={styles.subtitle}>
            This is how your storefront appears to customers.
          </p>
        </div>
        <Link className={styles.buttonSecondary} href="/field">
          Back to dashboard
        </Link>
      </header>

      <section className={styles.invoiceDetailCard} aria-label="Storefront preview">
        <div style={{ padding: '24px' }}>
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontFamily: 'var(--display-font)', fontSize: '1.5rem', marginBottom: '8px' }}>
              {config.hero.headline}
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: '1.1rem', marginBottom: '16px' }}>
              {config.hero.subheadline}
            </p>
          </div>

          {config.about.body && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>
                About {config.identity.businessName}
              </h3>
              <p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>
                {config.about.body}
              </p>
            </div>
          )}

          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>Services</h3>
            <div style={{ display: 'grid', gap: '12px' }}>
              {config.services.map((service) => (
                <div
                  key={service.slug}
                  style={{
                    padding: '12px 16px',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <strong>{service.name}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                      {service.priceFromCents !== null
                        ? `From ${formatCents(service.priceFromCents)}`
                        : 'Quote on request'}
                    </span>
                  </div>
                  {service.description && (
                    <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: 0 }}>
                      {service.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {config.serviceArea.description && (
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Service area</h3>
              <p style={{ maxWidth: '60ch' }}>{config.serviceArea.description}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
