'use client';

import { useState, type FormEvent } from 'react';

/**
 * The self-serve signup wizard: business details → AI/template storefront
 * preview → payment. Client-side only; every write goes through the platform
 * API routes (rate-limited, honeypot-protected, Stripe-gated).
 *
 * Steps:
 *   details  → Core business info + contact details
 *   design   → Template selection + tax rate
 *   preview  → AI-drafted storefront copy preview
 *   payment  → Redirect to Stripe Checkout (or skip if not configured)
 *   done     → Post-Stripe success confirmation
 */

type Details = {
  businessName: string;
  trade: string;
  town: string;
  notes: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
};

type Design = {
  templateId: string;
  taxRatePercent: string;
};

type AiServiceDraft = { slug: string; name: string; description: string };
type Draft = {
  tagline: string;
  hero: { headline: string; subheadline: string };
  about: { body: string };
  serviceArea: { description: string };
  services: AiServiceDraft[];
};

type Step = 'details' | 'design' | 'preview' | 'done';

const TEMPLATES = [
  { id: 'heritage-craft', name: 'Heritage Craft', description: 'Established, local, detailed' },
  { id: 'modern-grid', name: 'Modern Grid', description: 'Precise, organised, clear' },
  { id: 'neighborly-warm', name: 'Neighborly', description: 'Warm, familiar, approachable' },
  { id: 'industrial-pro', name: 'Industrial Pro', description: 'Direct, technical, capable' },
  { id: 'premium-home', name: 'Premium Home', description: 'Refined, calm, residential' },
  { id: 'direct-response', name: 'Direct Response', description: 'Lead-gen first, action-led' },
];

const EMPTY_DETAILS: Details = {
  businessName: '',
  trade: '',
  town: '',
  notes: '',
  phone: '',
  email: '',
  address: '',
  hours: '',
};

const EMPTY_DESIGN: Design = {
  templateId: 'heritage-craft',
  taxRatePercent: '0',
};

function clientSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'tenant';
}

function DraftPreview({ draft, businessName }: { draft: Draft; businessName: string }) {
  return (
    <div className="draft-preview">
      <div className="eyebrow">Your storefront at</div>
      <div className="subdomain-preview">{clientSlug(businessName)}.usejbox.com</div>

      <div className="card draft-card">
        <div className="eyebrow">Tagline</div>
        <div className="draft-tagline">{draft.tagline}</div>
      </div>

      <div className="card draft-card">
        <div className="eyebrow">Hero</div>
        <h3 className="draft-headline">{draft.hero.headline}</h3>
        <p>{draft.hero.subheadline}</p>
      </div>

      <div className="card draft-card">
        <div className="eyebrow">About</div>
        <p>{draft.about.body}</p>
      </div>

      <div className="card draft-card">
        <div className="eyebrow">Service area</div>
        <p>{draft.serviceArea.description}</p>
      </div>

      <div className="card draft-card">
        <div className="eyebrow">Services ({draft.services.length})</div>
        <ul className="draft-services">
          {draft.services.map((service) => (
            <li key={service.slug}>
              <strong>{service.name}</strong>
              <span>{service.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: (typeof TEMPLATES)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        border: selected ? '2px solid var(--brand-accent)' : '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        background: selected ? 'color-mix(in srgb, var(--brand-accent) 6%, #fff)' : '#fff',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <strong style={{ fontSize: '0.95rem' }}>{template.name}</strong>
      <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{template.description}</span>
      {selected && (
        <span style={{ fontSize: '0.75rem', color: 'var(--brand-accent)', fontWeight: 700, marginTop: 2 }}>
          ✓ Selected
        </span>
      )}
    </button>
  );
}

export default function OnboardingWizard() {
  const [step, setStep] = useState<Step>('details');
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [design, setDesign] = useState<Design>(EMPTY_DESIGN);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [source, setSource] = useState<'ai' | 'fallback'>('fallback');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    slug: string;
    canonicalHostname: string;
    organizationId?: string;
  } | null>(null);

  const setField = (field: keyof Details) => (value: string) => {
    setDetails((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const setDesignField = (field: keyof Design) => (value: string) => {
    setDesign((prev) => ({ ...prev, [field]: value }));
  };

  async function goToDesign(event: FormEvent) {
    event.preventDefault();
    if (!details.businessName.trim() || !details.trade.trim() || !details.town.trim()) {
      setError('Business name, trade, and town are required.');
      return;
    }
    if (!details.phone.trim() && !details.email.trim()) {
      setError('Add a phone number or email so customers can reach you.');
      return;
    }
    setError(null);
    setStep('design');
  }

  async function draftStorefront(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/platform/onboarding/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessName: details.businessName,
          trade: details.trade,
          town: details.town,
          notes: details.notes,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setError(body.error ?? 'Could not draft your storefront.');
        return;
      }
      setDraft(body.draft);
      setSource(body.source);
      setStep('preview');
    } catch {
      setError('Could not reach the draft service. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    if (!draft) return;
    setBusy(true);
    setError(null);

    const taxMillipercent = Math.round(
      Math.min(100, Math.max(0, Number(design.taxRatePercent) || 0)) * 1000,
    );

    try {
      const signupResponse = await fetch('/api/platform/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessName: details.businessName,
          trade: details.trade,
          town: details.town,
          notes: details.notes,
          phone: details.phone,
          email: details.email,
          address: details.address,
          hours: details.hours,
          templateId: design.templateId,
          taxRateMillipercent: taxMillipercent,
          draft,
          // Honeypot — bots filling hidden fields never reach billing.
          company_website: undefined,
        }),
      });
      const signupBody = await signupResponse.json();
      if (!signupResponse.ok || !signupBody.ok || !signupBody.tenant) {
        setError(signupBody.error ?? 'Could not complete your signup.');
        return;
      }

      const tenant = signupBody.tenant as {
        slug: string;
        canonicalHostname: string;
        organizationId?: string;
      };
      setResult(tenant);

      // Redirect to Stripe Checkout. If billing is not configured the API
      // returns skipBilling: true and we go straight to done.
      const billingResponse = await fetch('/api/platform/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: tenant.organizationId,
          slug: tenant.slug,
          email: details.email,
          businessName: details.businessName,
        }),
      });
      const billingBody = await billingResponse.json();

      if (billingBody.ok && billingBody.url) {
        // Full browser redirect to Stripe Checkout.
        window.location.href = billingBody.url;
        return;
      }

      // skipBilling or error — show the done step anyway.
      setStep('done');
    } catch {
      setError('Could not complete your signup right now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className="form" role="status">
        <p className="ok" style={{ fontSize: '1.05rem' }}>✓ Your storefront is on its way.</p>
        <div className="card">
          <h3>What happens next</h3>
          <ol style={{ paddingLeft: '1.25rem', display: 'grid', gap: '8px', margin: '10px 0 0' }}>
            <li>Your trial has started — no card charged yet.</li>
            <li>
              Your site is being set up at <strong>{result.canonicalHostname}</strong>.
              We verify the domain and activate your storefront.
            </li>
            <li>
              Staff sign in at{' '}
              <a href="https://field.usejbox.com">field.usejbox.com</a> — service
              requests from your site land straight in the Field queue.
            </li>
            <li>
              Manage your subscription any time from the Field workspace under
              <em> Settings → Billing</em>.
            </li>
          </ol>
        </div>
        <p><a className="button" href="/">Back to J-Box</a></p>
      </div>
    );
  }

  return (
    <>
      {/* Wizard progress indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {(['details', 'design', 'preview'] as const).map((s, i) => (
          <div
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: step === s ? 'var(--brand-accent)' : step === 'done' || (
                s === 'details' && (step === 'design' || step === 'preview')
              ) || (s === 'design' && step === 'preview') ? 'var(--muted)' : '#ccc',
              fontSize: '0.82rem',
              fontWeight: step === s ? 700 : 400,
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: '50%',
              background: step === s ? 'var(--brand-accent)' : '#e5e7eb',
              color: step === s ? '#fff' : 'var(--muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
            }}>{i + 1}</span>
            <span style={{ textTransform: 'capitalize' }}>{s === 'details' ? 'Your details' : s === 'design' ? 'Design' : 'Preview'}</span>
            {i < 2 && <span style={{ color: '#e5e7eb', marginLeft: 4 }}>›</span>}
          </div>
        ))}
      </div>

      {error && (
        <p className="form error" style={{ marginBottom: 16 }}>{error}</p>
      )}

      {/* ── Step 1: Details ─────────────────────────────────────────────── */}
      {step === 'details' && (
        <form className="form" onSubmit={goToDesign}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ gridColumn: '1 / -1' }}>
              Business name *
              <input
                value={details.businessName}
                onChange={(e) => setField('businessName')(e.target.value)}
                maxLength={200}
                required
                placeholder="Paris Electric Inc."
              />
            </label>
            <label>
              Trade *
              <input
                value={details.trade}
                onChange={(e) => setField('trade')(e.target.value)}
                maxLength={80}
                required
                placeholder="Electrician"
              />
            </label>
            <label>
              Town you serve *
              <input
                value={details.town}
                onChange={(e) => setField('town')(e.target.value)}
                maxLength={100}
                required
                placeholder="Patchogue, NY"
              />
            </label>
            <label>
              Phone
              <input
                type="tel"
                value={details.phone}
                onChange={(e) => setField('phone')(e.target.value)}
                maxLength={40}
                placeholder="(631) 555-0100"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={details.email}
                onChange={(e) => setField('email')(e.target.value)}
                maxLength={320}
                placeholder="info@pariselectric.com"
              />
            </label>
            <label>
              Address <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(shown on your site)</span>
              <input
                value={details.address}
                onChange={(e) => setField('address')(e.target.value)}
                maxLength={200}
                placeholder="123 Main St, Patchogue, NY 11772"
              />
            </label>
            <label>
              Hours
              <input
                value={details.hours}
                onChange={(e) => setField('hours')(e.target.value)}
                maxLength={100}
                placeholder="Mon–Fri 7am–5pm"
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Anything else to know?
              <textarea
                value={details.notes}
                onChange={(e) => setField('notes')(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Family business for 20 years, specialise in residential panel upgrades…"
              />
            </label>
          </div>

          {/* Honeypot — bots fill this; humans never see it */}
          <input
            type="text"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
            style={{ display: 'none' }}
            aria-hidden="true"
          />

          <button className="button" type="submit">Continue to design →</button>
        </form>
      )}

      {/* ── Step 2: Design ──────────────────────────────────────────────── */}
      {step === 'design' && (
        <div className="form">
          <div>
            <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Choose a look for your storefront</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {TEMPLATES.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  selected={design.templateId === t.id}
                  onSelect={() => setDesignField('templateId')(t.id)}
                />
              ))}
            </div>
          </div>

          <label>
            Sales tax rate %{' '}
            <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '0.82rem' }}>
              (applied to taxable estimate line items)
            </span>
            <input
              type="number"
              min="0"
              max="30"
              step="0.001"
              value={design.taxRatePercent}
              onChange={(e) => setDesignField('taxRatePercent')(e.target.value)}
              placeholder="0"
              style={{ maxWidth: 140 }}
            />
          </label>
          <p style={{ margin: '-8px 0 0', fontSize: '0.82rem', color: 'var(--muted)' }}>
            You can change this later in Field settings. NY standard rate is 8.625%.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="button" type="button" onClick={() => draftStorefront()} disabled={busy}>
              {busy ? 'Drafting your site…' : 'Draft my storefront →'}
            </button>
            <button className="button secondary" type="button" onClick={() => setStep('details')}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview ─────────────────────────────────────────────── */}
      {step === 'preview' && draft && (
        <div>
          <DraftPreview draft={draft} businessName={details.businessName} />
          {source === 'fallback' && (
            <p className="muted-note" style={{ marginTop: 12 }}>
              Copy was drafted from a template — you can edit it after signing up.
            </p>
          )}
          <div className="cta-row" style={{ marginTop: 20 }}>
            <button className="button" onClick={signUp} disabled={busy}>
              {busy ? 'Creating your account…' : 'Looks good — start my free trial →'}
            </button>
            <button className="button secondary" onClick={() => draftStorefront()} disabled={busy}>
              Regenerate copy
            </button>
            <button
              className="button secondary"
              onClick={() => setStep('design')}
              disabled={busy}
            >
              ← Edit design
            </button>
          </div>
          <p style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--muted)' }}>
            14-day free trial · No credit card required to start · Cancel any time
          </p>
        </div>
      )}
    </>
  );
}
