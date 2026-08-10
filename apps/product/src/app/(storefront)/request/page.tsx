import { loadStorefront } from '@/lib/tenant';
import { RequestForm } from './request-form';

export const dynamic = 'force-dynamic';

export default async function RequestPage() {
  const { config } = await loadStorefront();

  return (
    <section className="section">
      <div className="container">
        <h1>Request a quote</h1>
        <p style={{ color: 'var(--muted)', maxWidth: '52ch' }}>
          Tell us what you need. Someone from {config.identity.businessName} will
          get back to you.
        </p>
        <RequestForm services={config.services} />
      </div>
    </section>
  );
}
