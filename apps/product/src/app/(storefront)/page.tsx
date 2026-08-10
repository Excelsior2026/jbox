import { loadStorefront, formatCents } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function StorefrontHome() {
  const { config } = await loadStorefront();

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{config.hero.headline}</h1>
          <p>{config.hero.subheadline}</p>
          <div className="cta-row">
            <a className="button" href="/request">Request a quote</a>
            <a className="button secondary" href="/services">Our services</a>
          </div>
        </div>
      </section>

      {config.about.body && (
        <section className="section">
          <div className="container">
            <h2>About {config.identity.businessName}</h2>
            <p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{config.about.body}</p>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <h2>Services</h2>
          <div className="card-grid">
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
          <p><a href="/services">See all services</a></p>
        </div>
      </section>

      {config.serviceArea.description && (
        <section className="section">
          <div className="container">
            <h2>Service area</h2>
            <p style={{ maxWidth: '60ch' }}>{config.serviceArea.description}</p>
          </div>
        </section>
      )}
    </>
  );
}
