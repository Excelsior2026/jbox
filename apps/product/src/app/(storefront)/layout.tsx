import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import {
  publicSiteThemeClass,
  type BrandPalette,
  type ConfigV1,
} from '@contractor-platform/configuration';
import { loadStorefront } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * The browser tab carries the tenant's name, not the platform's. The same
 * fail-closed resolve the layout uses; when there is no resolvable tenant the
 * placeholder keeps the platform title.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const { config } = await loadStorefront();
    return { title: config.identity.businessName };
  } catch {
    return { title: 'J-Box' };
  }
}

function brandVars(brand: BrandPalette): CSSProperties {
  return {
    '--brand-primary': brand.primaryColor,
    '--brand-accent': brand.accentColor,
    '--brand-surface': brand.surfaceColor,
  } as CSSProperties;
}

/**
 * Storefront chrome. Resolves the tenant and its in-force configuration once
 * per request and renders the header/footer around the page. Templates vary
 * presentation only: the theme class (derived from templateId) switches the
 * CSS variables the whole tree inherits.
 *
 * Fails closed: if the host is not a verified tenant or has no approved config,
 * the visitor sees a neutral placeholder instead of half a tenant.
 */
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  let config: ConfigV1;
  try {
    config = (await loadStorefront()).config;
  } catch {
    return (
      <main className="container" style={{ padding: '96px 24px' }}>
        <h1>This storefront is not available yet.</h1>
        <p>It is either not set up, or the business&apos;s public site is not active.</p>
      </main>
    );
  }

  return (
    <div className={publicSiteThemeClass(config.templateId)} style={brandVars(config.brand)}>
      <header className="site-header">
        <div className="container">
          <a className="brand-name" href="/">{config.identity.businessName}</a>
          <nav className="site-nav">
            <a href="/">Home</a>
            <a href="/services">Services</a>
            <a href="/request">Request a quote</a>
          </nav>
        </div>
      </header>

      {children}

      <footer className="site-footer">
        <div className="container">
          <div><strong>{config.identity.businessName}</strong> — {config.identity.tagline}</div>
          {config.contact.address && <div>{config.contact.address}</div>}
          {(config.contact.phone || config.contact.email) && (
            <div>
              {config.contact.phone && <span>{config.contact.phone}</span>}
              {config.contact.phone && config.contact.email && ' · '}
              {config.contact.email && (
                <a href={`mailto:${config.contact.email}`}>{config.contact.email}</a>
              )}
            </div>
          )}
          {config.contact.hours && <div>{config.contact.hours}</div>}
          {config.serviceArea.description && <div>Serving: {config.serviceArea.description}</div>}
          <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--muted)' }}>
            Powered by J-Box · <a href="https://field.usejbox.com">Staff sign-in</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
