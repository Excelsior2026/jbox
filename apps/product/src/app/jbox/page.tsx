export default function JBoxDashboardPage() {
  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', color: 'white', margin: '0 0 8px' }}>
          Shop Control
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
          Active work orders, crew status, and dispatch queue.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {[
          { label: 'Active Jobs', value: '—', color: '#f59e0b' },
          { label: 'Pending Bids', value: '—', color: '#3b82f6' },
          { label: 'Open Invoices', value: '—', color: '#ef4444' },
          { label: 'Clients This Week', value: '—', color: '#10b981' },
        ].map((stat) => (
          <div key={stat.label} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: '8px' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 900, color: stat.color, fontFamily: 'ui-monospace, monospace' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '32px', textAlign: 'center' }}>
        <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
          Connect a database to see live job data
        </p>
      </div>
    </div>
  );
}
