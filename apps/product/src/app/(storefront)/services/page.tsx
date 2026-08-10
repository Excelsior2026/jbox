import { loadStorefront, formatCents } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const { config } = await loadStorefront();

  return (
    <section className="section">
      <div className="container">
        <h1>Services</h1>
        <p style={{ color: 'var(--muted)', maxWidth: '52ch' }}>
          {config.identity.businessName} — {config.identity.tagline}
        </p>

        <div className="card-grid" style={{ marginTop: '24px' }}>
          {config.services.map((service) => (
            <div className="card" key={service.slug}>
              <h3>{service.name}</h3>
              <p>{service.description}</p>
              <span className="price">
                {service.priceFromCents !== null
                  ? `From ${formatCents(service.priceFromCents)}`
                  : 'Quote on request'}
              </span>
            </div>
          ))}
        </div>

        <p style={{ marginTop: '32px' }}>
          <a className="button" href="/request">Request a quote</a>
        </p>
      </div>
    </section>
  );
}
