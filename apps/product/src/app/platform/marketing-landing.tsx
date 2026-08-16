import type { ReactNode } from 'react';

/**
 * The product landing page served on the apex domain (usejbox.com). Pure
 * marketing — no tenant data, no database. Sells the storefront-to-Field loop
 * with pricing, and moves the visitor to /onboarding.
 */

function Header() {
  return (
    <header className="site-header">
      <div className="container">
        <a className="brand-name" href="/">J-Box</a>
        <nav className="site-nav">
          <a href="/#how-it-works">How it works</a>
          <a href="/#features">Features</a>
          <a href="/#pricing">Pricing</a>
          <a className="button" href="/onboarding">Start free trial</a>
        </nav>
      </div>
    </header>
  );
}

function Feature({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <div className="card step-card">
      <div className="step-num">{number}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function PricingCard({
  name,
  price,
  unit,
  description,
  features,
  cta,
  ctaHref,
  highlight,
}: {
  name: string;
  price: string;
  unit: string;
  description: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="card"
      style={{
        border: highlight ? '2px solid var(--brand-accent)' : '1px solid var(--line)',
        position: 'relative',
        paddingTop: highlight ? '28px' : '20px',
      }}
    >
      {highlight && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%) translateY(-50%)',
          background: 'var(--brand-accent)', color: '#fff',
          padding: '3px 14px', borderRadius: '999px', fontSize: '0.72rem',
          fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>Most popular</div>
      )}
      <p style={{ margin: '0 0 4px', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>{name}</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '0 0 6px' }}>
        <span style={{ fontSize: '2.2rem', fontWeight: 700, fontFamily: 'var(--display-font)' }}>{price}</span>
        <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{unit}</span>
      </div>
      <p style={{ margin: '0 0 18px', color: 'var(--muted)', fontSize: '0.9rem' }}>{description}</p>
      <ul style={{ margin: '0 0 20px', padding: '0 0 0 1rem', display: 'grid', gap: 8 }}>
        {features.map((f) => (
          <li key={f} style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
            <span style={{ color: '#047857', fontWeight: 700, marginRight: 6 }}>✓</span>{f}
          </li>
        ))}
      </ul>
      <a
        className={`button${!highlight ? ' secondary' : ''}`}
        href={ctaHref}
        style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
      >
        {cta}
      </a>
    </div>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div>
          <strong>J-Box</strong> — storefront and Field for small trade contractors.
        </div>
        <div style={{ marginTop: '6px' }}>
          <a href="/onboarding">Start free trial</a> ·{' '}
          <a href="/#pricing">Pricing</a> ·{' '}
          <a href="/field">Staff sign-in</a>
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLanding() {
  return (
    <main>
      <Header />

      {/* Hero */}
      <section className="hero">
        <div className="container">
          <div className="eyebrow">For small trade contractors</div>
          <h1>Your storefront and your back office, one system.</h1>
          <p>
            J-Box gives you a professional customer website and a Field workspace for estimates,
            jobs, and invoices. Every lead your storefront collects lands straight in your work
            queue — no re-entry, no copy-paste.
          </p>
          <div className="cta-row">
            <a className="button" href="/onboarding">Start your free trial</a>
            <a className="button secondary" href="/#how-it-works">See how it works</a>
          </div>
          <p style={{ marginTop: 16, fontSize: '0.85rem', color: 'var(--muted)' }}>
            14-day free trial · No credit card required · Cancel any time
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="section" id="how-it-works">
        <div className="container">
          <div className="eyebrow">How it works</div>
          <h2>From a few facts to a live storefront.</h2>
          <div className="card-grid">
            <Step number="1" title="Tell us about your business">
              Your name, your trade, your town. The platform drafts your storefront copy
              — tagline, headline, service descriptions — in seconds.
            </Step>
            <Step number="2" title="Pick a look and preview">
              Choose from six professional templates, set your tax rate, and review your
              storefront exactly as customers will see it.
            </Step>
            <Step number="3" title="Go live and run your work in Field">
              Your site goes up on yourbusiness.usejbox.com. Service requests become leads
              in your Field workspace, ready to turn into signed estimates.
            </Step>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section" id="features" style={{ background: 'var(--brand-surface)' }}>
        <div className="container">
          <div className="eyebrow">Features</div>
          <h2>Everything a small trade business needs to run.</h2>
          <div className="card-grid">
            <Feature title="Your own storefront">
              A branded site on yourbusiness.usejbox.com — six template designs, your
              brand colors, service area, and a request form with photos.
            </Feature>
            <Feature title="Leads straight to Field">
              Every request from your site lands in your Field queue as a lead.
              The storefront and the workspace are one system by design.
            </Feature>
            <Feature title="Estimates customers can sign">
              Send a link-based estimate and your customer approves or declines it online —
              no account, no app. Signed estimates are legally frozen.
            </Feature>
            <Feature title="Jobs and invoices">
              Convert a signed estimate into a job and invoice in one click. Track
              materials, schedule work, and record payments in one place.
            </Feature>
            <Feature title="Private price book">
              Build a catalog of your standard services and materials. Pricing stays
              your business — never public, never shared with competitors.
            </Feature>
            <Feature title="AI-assisted setup">
              Describe your business and the platform drafts your site copy. You
              approve what goes public — the model never sets your pricing.
            </Feature>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section" id="pricing" style={{ background: '#f9fafb' }}>
        <div className="container">
          <div className="eyebrow">Pricing</div>
          <h2>Simple, transparent pricing.</h2>
          <p style={{ color: 'var(--muted)', maxWidth: '54ch', marginBottom: 36 }}>
            One price covers both surfaces — your storefront and the Field workspace.
            No per-seat fees, no add-ons. Start with a 14-day free trial.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, maxWidth: 860, margin: '0 auto' }}>
            <PricingCard
              name="Starter"
              price="$49"
              unit="/ month"
              description="Everything you need to replace paper estimating and go live on the web."
              features={[
                'Branded storefront on yourbiz.usejbox.com',
                'Unlimited estimates & customer links',
                'Jobs and invoices',
                'Price book (up to 500 items)',
                'Up to 3 staff members',
                '5 GB photo storage',
              ]}
              cta="Start 14-day free trial"
              ctaHref="/onboarding"
            />
            <PricingCard
              name="Pro"
              price="$99"
              unit="/ month"
              description="For growing operations with more staff and higher volume."
              features={[
                'Everything in Starter',
                'Up to 10 staff members',
                'Unlimited price book items',
                'Inventory module (stock & counts)',
                'Appointment scheduling',
                '25 GB photo storage',
                'Priority support',
              ]}
              cta="Start 14-day free trial"
              ctaHref="/onboarding"
              highlight
            />
          </div>
          <p style={{ textAlign: 'center', marginTop: 28, color: 'var(--muted)', fontSize: '0.88rem' }}>
            All plans include the full storefront + Field workspace.
            Prices shown in USD. NY-based contractor? Standard 8.625% sales tax applies.{' '}
            <a href="mailto:support@usejbox.com">Contact us</a> for annual billing.
          </p>
        </div>
      </section>

      {/* CTA band */}
      <section className="section cta-band">
        <div className="container">
          <h2>Get your storefront running today.</h2>
          <p>Your first 14 days are free. No credit card required to start.</p>
          <div className="cta-row">
            <a className="button" href="/onboarding">Start your free trial</a>
            <a className="button secondary" href="/field">Staff sign-in</a>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
