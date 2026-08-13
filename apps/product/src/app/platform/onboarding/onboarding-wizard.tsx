'use client';

import { useState, type FormEvent } from 'react';

/**
 * The self-serve signup wizard: business details → AI/template storefront
 * preview → signup through the control plane. Client-side only; every write
 * goes through the platform API routes (rate-limited, honeypot-protected).
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

type AiServiceDraft = { slug: string; name: string; description: string };
type Draft = {
  tagline: string;
  hero: { headline: string; subheadline: string };
  about: { body: string };
  serviceArea: { description: string };
  services: AiServiceDraft[];
};

type Step = 'details' | 'preview' | 'done';

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
        <div className="eyebrow">Services</div>
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

export default function OnboardingWizard() {
  const [step, setStep] = useState<Step>('details');
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [source, setSource] = useState<'ai' | 'fallback'>('fallback');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ slug: string; canonicalHostname: string } | null>(null);

  const set = (field: keyof Details) => (value: string) => {
    setDetails((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  async function draftStorefront(event: FormEvent) {
    event.preventDefault();
    if (!details.businessName.trim() || !details.trade.trim() || !details.town.trim()) {
      setError('Business name, trade, and town are required.');
      return;
    }
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
    if (!details.phone.trim() && !details.email.trim()) {
      setError('Add a phone number or email so customers can reach you.');
      setStep('details');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/platform/onboarding', {
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
          templateId: 'heritage-craft',
          draft,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok || !body.tenant) {
        setError(body.error ?? 'Could not complete your signup.');
        return;
      }
      setResult({ slug: body.tenant.slug, canonicalHostname: body.tenant.canonicalHostname });
      setStep('done');
    } catch {
      setError('Could not complete your signup right now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done' && result) {
    return (
      <div className="form" role="status">
        <p className="ok">Your storefront is on its way.</p>
        <div className="card">
          <h3>What happens next</h3>
          <ul>
            <li>
              Your site is being set up at <strong>{result.canonicalHostname}</strong>.
            </li>
            <li>We verify the domain and activate your storefront.</li>
            <li>
              Once live, staff sign in at{' '}
              <a href="https://field.usejbox.com">field.usejbox.com</a> and the
              requests from your site land straight in the Field queue.
            </li>
          </ul>
        </div>
        <p>
          <a className="button" href="/">Back to J-Box</a>
        </p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="form error" style={{ color: '#b91c1c' }}>{error}</p>}

      {step === 'details' && (
        <form className="form" onSubmit={draftStorefront}>
          <label>
            Business name *
            <input
              value={details.businessName}
              onChange={(event) => set('businessName')(event.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label>
            Trade * (e.g. electrician, plumber, roofer)
            <input
              value={details.trade}
              onChange={(event) => set('trade')(event.target.value)}
              maxLength={80}
              required
            />
          </label>
          <label>
            Town you serve * (e.g. Patchogue, NY)
            <input
              value={details.town}
              onChange={(event) => set('town')(event.target.value)}
              maxLength={100}
              required
            />
          </label>
          <label>
            Anything else we should know?
            <textarea
              value={details.notes}
              onChange={(event) => set('notes')(event.target.value)}
              maxLength={2000}
              rows={3}
            />
          </label>

          <label>
            Phone
            <input
              value={details.phone}
              onChange={(event) => set('phone')(event.target.value)}
              maxLength={40}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={details.email}
              onChange={(event) => set('email')(event.target.value)}
              maxLength={320}
            />
          </label>
          <label>
            Address (shown on your site)
            <input
              value={details.address}
              onChange={(event) => set('address')(event.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            Hours (e.g. Mon-Fri 8a-5p)
            <input
              value={details.hours}
              onChange={(event) => set('hours')(event.target.value)}
              maxLength={100}
            />
          </label>

          <input
            type="text"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
            style={{ display: 'none' }}
            aria-hidden="true"
          />

          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Drafting…' : 'Draft my storefront'}
          </button>
        </form>
      )}

      {step === 'preview' && draft && (
        <div>
          <DraftPreview draft={draft} businessName={details.businessName} />
          {source === 'fallback' && (
            <p className="muted-note">
              Copy was drafted from a template. It will read better once a copywriter
              or AI review is enabled on this tenant.
            </p>
          )}
          <div className="cta-row">
            <button className="button" onClick={signUp} disabled={busy}>
              {busy ? 'Setting up…' : 'Looks good — set up my storefront'}
            </button>
            <button className="button secondary" onClick={draftStorefront} disabled={busy}>
              Regenerate copy
            </button>
            <button
              className="button secondary"
              onClick={() => setStep('details')}
              disabled={busy}
            >
              Edit details
            </button>
          </div>
        </div>
      )}
    </>
  );
}
