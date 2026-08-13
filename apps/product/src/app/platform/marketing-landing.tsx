import type { ReactNode } from 'react';

/**
 * The product landing page served on the apex domain (usejbox.com). Pure
 * marketing — no tenant data, no database. The one job of this page is to
 * explain what J-Box does, sell the storefront-to-Field loop, and move the
 * visitor to /onboarding.
 */

function Header() {
  return (
    <header className="site-header">
      <div className="container">
        <a className="brand-name" href="/">J-Box</a>
        <nav className="site-nav">
          <a href="/#how-it-works">How it works</a>
          <a href="/#features">Features</a>
          <a className="button" href="/onboarding">Start free</a>
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

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div>
          <strong>J-Box</strong> — storefront and Field for small trade contractors.
        </div>
        <div style={{ marginTop: '6px' }}>
          <a href="/onboarding">Start onboarding</a> · <a href="/field">Staff sign-in</a>
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLanding() {
  return (
    <main>
      <Header />

      <section className="hero">
        <div className="container">
          <div className="eyebrow">For small trade contractors</div>
          <h1>Your storefront and your back office, one system.</h1>
          <p>
            J-Box gives you a professional customer website on your own subdomain
            and a Field workspace for estimates, jobs, and invoices. Every lead
            your storefront collects lands straight in your work queue — nothing
            to copy, nothing to re-enter.
          </p>
          <div className="cta-row">
            <a className="button" href="/onboarding">Start your storefront</a>
            <a className="button secondary" href="/#how-it-works">See how it works</a>
          </div>
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="container">
          <div className="eyebrow">How it works</div>
          <h2>From a few facts to a live storefront.</h2>
          <div className="card-grid">
            <Step number="1" title="Tell us about your business">
              Your name, your trade, your town. The platform drafts your
              storefront copy for you — tagline, headline, service descriptions.
            </Step>
            <Step number="2" title="Preview and confirm">
              See your storefront as your customers will. Pick a look, keep or
              edit the copy, and sign up.
            </Step>
            <Step number="3" title="Go live and work it in Field">
              Your site goes up on yourbusiness.usejbox.com. Requests from it
              become leads in your Field workspace, ready to turn into estimates.
            </Step>
          </div>
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <div className="eyebrow">Features</div>
          <h2>Everything a small trade business needs to run.</h2>
          <div className="card-grid">
            <Feature title="Your own storefront">
              A branded site on yourbusiness.usejbox.com — services, service area,
              and a request form with photos. Offline until you are live.
            </Feature>
            <Feature title="Seamless to Field">
              Every request from your site lands in your Field queue as a lead.
              The storefront and the workspace share one system by design.
            </Feature>
            <Feature title="Estimates customers can approve">
              Send an estimate and your customer approves or declines it online —
              no account, no app to install.
            </Feature>
            <Feature title="Jobs and invoices">
              Track jobs, materials, and billing from the same place you manage
              estimates. One record of the work, start to finish.
            </Feature>
            <Feature title="Built-in multi-tenant security">
              Every business on J-Box is isolated at the database layer with
              row-level security. Your data is never visible to anyone else.
            </Feature>
            <Feature title="AI-assisted onboarding">
              Describe your business and the platform drafts your site copy. You
              approve what goes public — the model never sets your pricing.
            </Feature>
          </div>
        </div>
      </section>

      <section className="section cta-band">
        <div className="container">
          <h2>Get your storefront running in minutes.</h2>
          <p>No credit card, no forms to fax, no waiting on a designer.</p>
          <div className="cta-row">
            <a className="button" href="/onboarding">Start your storefront</a>
            <a className="button secondary" href="/field">Staff sign-in</a>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
