'use client';

import { useState, type FormEvent } from 'react';
import type { ServiceDefinition } from '@contractor-platform/configuration';

type State = { status: 'idle' | 'submitting' | 'success' | 'error'; message?: string };

/**
 * The storefront request form. Submits multipart (name + message + up to five
 * photos) to /api/requests, which is the only path that knows how to write a
 * service_request and its photo rows atomically. On success the form is
 * replaced by the confirmation; on failure the error is shown inline so the
 * visitor does not lose their typed input.
 */
export function RequestForm({ services }: { services: ServiceDefinition[] }) {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: 'submitting' });
    try {
      const form = event.currentTarget;
      const response = await fetch('/api/requests', {
        method: 'POST',
        body: new FormData(form),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Something went wrong.');
      }
      form.reset();
      setState({ status: 'success', message: `Your reference is ${body.displayId}.` });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  }

  if (state.status === 'success') {
    return (
      <div className="form">
        <p className="ok">Thanks! Your request has been sent. {state.message}</p>
        <p>We&apos;ll be in touch soon.</p>
        <button
          className="button secondary"
          onClick={() => setState({ status: 'idle' })}
          style={{ width: 'max-content' }}
        >
          Send another request
        </button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} encType="multipart/form-data">
      <label>
        Your name *
        <input type="text" name="contactName" required maxLength={200} autoComplete="name" />
      </label>
      <label>
        Email
        <input type="email" name="contactEmail" maxLength={320} autoComplete="email" />
      </label>
      <label>
        Phone
        <input type="tel" name="contactPhone" maxLength={40} autoComplete="tel" />
      </label>
      <label>
        Service
        <select name="serviceSlug" defaultValue="">
          <option value="">Not sure / something else</option>
          {services.map((service) => (
            <option key={service.slug} value={service.slug}>{service.name}</option>
          ))}
        </select>
      </label>
      <label>
        Service address
        <input type="text" name="serviceAddress" maxLength={200} autoComplete="street-address" />
      </label>
      <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: '1fr 1fr' }}>
        <label>
          Town
          <input type="text" name="town" maxLength={100} />
        </label>
        <label>
          Postal code
          <input type="text" name="postalCode" maxLength={20} />
        </label>
      </div>
      <label>
        What do you need? *
        <textarea name="summary" required maxLength={300} rows={3} />
      </label>
      <label>
        Details
        <textarea name="message" maxLength={4000} rows={5} />
      </label>
      <label>
        Photos (up to 5)
        <input type="file" name="photos" multiple accept="image/*" />
      </label>
      {state.status === 'error' && (
        <p className="error" role="alert">{state.message}</p>
      )}
      <button className="button" type="submit" disabled={state.status === 'submitting'}>
        {state.status === 'submitting' ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}
