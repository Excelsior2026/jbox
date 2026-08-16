import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Welcome to J-Box — Setup complete',
  robots: { index: false, follow: false },
};

/**
 * Stripe redirects here after a successful Checkout Session.
 * The subscription lifecycle is handled via webhook; this page is purely
 * a confirmation screen.
 */
export default function OnboardingSuccess() {
  return (
    <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: '48px 24px' }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: '#ecfdf5', color: '#047857',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.6rem', margin: '0 auto 20px',
        }}>✓</div>
        <h1 style={{ fontFamily: 'var(--display-font)', fontSize: '1.8rem', margin: '0 0 12px' }}>
          You&apos;re all set.
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: 28, fontSize: '1.05rem' }}>
          Your storefront is being activated and your 14-day free trial has started.
          You won&apos;t be charged until your trial ends.
        </p>

        <div style={{
          border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          padding: '20px 24px', textAlign: 'left', marginBottom: 28,
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>What&apos;s next</h3>
          <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: 10, color: 'var(--muted)', fontSize: '0.92rem' }}>
            <li>
              <strong style={{ color: 'var(--text)' }}>Sign in to Field</strong> —{' '}
              your staff workspace at{' '}
              <a href="https://field.usejbox.com">field.usejbox.com</a>.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Wait for DNS</strong> —{' '}
              we&apos;ll verify your subdomain and activate your storefront.
              This usually takes a few minutes.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Start pricing work</strong> —{' '}
              create your first estimate from the Field dashboard.
            </li>
          </ol>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            className="button"
            href="https://field.usejbox.com"
            style={{ textDecoration: 'none' }}
          >
            Go to Field workspace →
          </a>
          <a
            className="button secondary"
            href="/"
            style={{ textDecoration: 'none' }}
          >
            Back to J-Box
          </a>
        </div>
      </div>
    </main>
  );
}
