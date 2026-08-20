'use client';

import { useState } from 'react';

export default function DispatchRequestPage() {
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const category = (form.elements.namedItem('category') as HTMLSelectElement).value;
    const work = (form.elements.namedItem('work') as HTMLTextAreaElement).value;
    const location = (form.elements.namedItem('location') as HTMLInputElement).value;

    try {
      const res = await fetch('/api/dispatch/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, workRequired: work, siteLocation: location }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Failed to submit request.');
        return;
      }
      setTicket(body.ticketNumber);
    } catch {
      setError('Could not reach dispatch. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (ticket) {
    return (
      <section className="dispatch-section" style={{ textAlign: 'center', paddingTop: '96px' }}>
        <div className="dispatch-badge" style={{ marginBottom: '24px' }}>Request Received</div>
        <h1>Your Ticket</h1>
        <p style={{ color: '#f59e0b', fontFamily: 'ui-monospace, monospace', fontSize: '2rem', fontWeight: 900, margin: '16px 0' }}>
          {ticket}
        </p>
        <p className="subdeck" style={{ margin: '0 auto 32px' }}>
          Save this ticket number. Our dispatch team will review your request
          and send a qualified technician with a firm bid.
        </p>
        <a href="/dispatch/track" className="dispatch-btn dispatch-btn-primary">
          Track This Request
        </a>
      </section>
    );
  }

  return (
    <section className="dispatch-section">
      <h1>Submit a Service Request</h1>
      <p className="subdeck">
        Describe the work you need. Our dispatch team will send a
        qualified technician and a firm bid within the hour.
      </p>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', padding: '12px', marginBottom: '20px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <form className="dispatch-form" onSubmit={handleSubmit}>
        <div className="dispatch-field">
          <label htmlFor="category">Service Category</label>
          <select id="category" required>
            <option value="">Select trade...</option>
            <option value="electrical">Electrical</option>
            <option value="plumbing">Plumbing</option>
            <option value="hvac">HVAC / Mechanical</option>
            <option value="general">General Contracting</option>
          </select>
        </div>

        <div className="dispatch-field">
          <label htmlFor="work">Work Required</label>
          <textarea
            id="work"
            required
            placeholder="Describe the issue or project scope..."
          />
        </div>

        <div className="dispatch-field">
          <label htmlFor="location">Site Location / Access Notes</label>
          <input
            id="location"
            type="text"
            placeholder="Address, gate code, access instructions..."
          />
        </div>

        <div className="dispatch-field">
          <label>Upload Job Site Photos</label>
          <div className="dispatch-upload-area">
            Tap to attach photos (optional)
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="dispatch-btn dispatch-btn-submit"
        >
          {loading ? 'Sending...' : 'Send Request & Get Estimate'}
        </button>
      </form>
    </section>
  );
}
