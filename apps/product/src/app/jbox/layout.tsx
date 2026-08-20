import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getFieldPrincipal } from '@/lib/field-api-auth';
import { isFieldAuthConfigured } from '@/lib/identity-environment';
import { ROLE_LABELS } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box Job Management',
  description: 'Job management system for trade contractors.',
  robots: { index: false, follow: false },
};

const jboxNavItems = [
  { label: 'Shop Control', href: '/jbox' },
  { label: 'Client Accounts', href: '/jbox/customers' },
  { label: 'Bids & Takeoffs', href: '/jbox/estimates' },
  { label: 'Work Orders', href: '/jbox/jobs' },
  { label: 'Parts & Rates Index', href: '/jbox/price-book' },
  { label: 'Billing & Tickets', href: '/jbox/invoices' },
];

export default async function JBoxLayout({ children }: { children: ReactNode }) {
  const principal = await getFieldPrincipal();

  if (!principal) {
    if (isFieldAuthConfigured()) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#f1f5f9' }}>
          <section style={{ textAlign: 'center', padding: '48px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f59e0b', marginBottom: '12px' }}>
              J-BOX
            </p>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', margin: '0 0 8px' }}>
              Sign in required
            </h1>
            <p style={{ color: '#94a3b8', marginBottom: '24px' }}>
              Authenticate to access the Job Management System.
            </p>
            <Link href="/field/login" style={{ display: 'inline-block', background: '#f59e0b', color: '#0f172a', padding: '12px 24px', borderRadius: '6px', fontWeight: 900, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', textDecoration: 'none' }}>
              Sign in
            </Link>
          </section>
        </main>
      );
    }

    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#f1f5f9' }}>
        <section style={{ textAlign: 'center', padding: '48px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase' }}>
            Staff access not configured
          </h1>
        </section>
      </main>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <aside style={{ width: '256px', borderRight: '1px solid #1e293b', background: '#1e293b', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
            <span style={{ background: '#f59e0b', color: '#0f172a', fontWeight: 900, padding: '6px 10px', borderRadius: '4px', fontSize: '13px', letterSpacing: '0.1em' }}>
              J-BOX
            </span>
            <span style={{ fontWeight: 700, letterSpacing: '0.1em', fontSize: '11px', textTransform: 'uppercase', color: '#94a3b8' }}>
              Job Management System
            </span>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {jboxNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#cbd5e1',
                  textDecoration: 'none',
                  transition: 'background 150ms, color 150ms',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div style={{ borderTop: '1px solid #334155', paddingTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#64748b' }}>
          <span>{ROLE_LABELS[principal.role]}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            Active
          </span>
        </div>
      </aside>

      <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>{children}</main>
    </div>
  );
}
