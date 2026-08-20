'use client';

import { useState } from 'react';

export default function DispatchRequestPage() {
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO: wire to /api/dispatch/requests
    setTimeout(() => setLoading(false), 1200);
  };

  return (
    <section className="dispatch-section">
      <h1>Submit a Service Request</h1>
      <p className="subdeck">
        Describe the work you need. Our dispatch team will send a
        qualified technician and a firm bid within the hour.
      </p>

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
