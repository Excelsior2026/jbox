'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function JBoxSetupWizard() {
  const router = useRouter();
  const [tradeCategory, setTradeCategory] = useState('electrical');
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/platform/jbox-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, tradeCategory }),
      });

      const body = await res.json();

      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Setup failed. Please try again.');
        return;
      }

      router.push('/jbox');
    } catch {
      setError('Could not reach the setup service. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f172a',
      color: '#f1f5f9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        maxWidth: '440px',
        width: '100%',
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '32px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{ marginBottom: '24px' }}>
          <span style={{
            background: '#f59e0b',
            color: '#0f172a',
            fontWeight: 900,
            padding: '4px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            J-BOX Setup
          </span>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: 900,
            textTransform: 'uppercase',
            color: 'white',
            margin: '12px 0 4px',
          }}>
            Configure Your Trade System
          </h1>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
            Select your primary trade to build your custom sketch palette and price book defaults.
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            padding: '12px',
            marginBottom: '20px',
            color: '#fca5a5',
            fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#cbd5e1',
              marginBottom: '8px',
            }}>
              Business / Shop Name
            </label>
            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Apex Mechanical LLC"
              style={{
                width: '100%',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '14px',
                color: '#f1f5f9',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#cbd5e1',
              marginBottom: '8px',
            }}>
              Primary Trade Category
            </label>
            <select
              value={tradeCategory}
              onChange={(e) => setTradeCategory(e.target.value)}
              style={{
                width: '100%',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '14px',
                color: '#f1f5f9',
                boxSizing: 'border-box',
              }}
            >
              <option value="electrical">Electrical Contracting</option>
              <option value="plumbing">Plumbing &amp; Piping</option>
              <option value="hvac">HVAC &amp; Mechanical</option>
              <option value="general">General Contracting</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? '#d97706' : '#f59e0b',
              color: '#0f172a',
              fontWeight: 900,
              textTransform: 'uppercase',
              padding: '14px',
              borderRadius: '6px',
              fontSize: '12px',
              letterSpacing: '0.08em',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 150ms',
            }}
          >
            {loading ? 'Initializing J-Box...' : 'Initialize Trade Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
