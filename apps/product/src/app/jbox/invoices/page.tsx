export default function JBoxInvoicesPage() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', color: 'white', margin: '0 0 8px' }}>
        Billing &amp; Tickets
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 32px' }}>
        Invoices, payment tracking, and service tickets.
      </p>
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '32px', textAlign: 'center' }}>
        <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
          Connect a database to see billing data
        </p>
      </div>
    </div>
  );
}
