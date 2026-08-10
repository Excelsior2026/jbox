/**
 * The platform shell: served on the apex domain, the Field sign-in host, and
 * any deployment hostname, which the proxy rewrites here. Public and tenant-free
 * by construction — this is the one page that must never render tenant data.
 */
export default function PlatformPage() {
  return (
    <main className="container">
      <header className="site-header">
        <div className="container">
          <span className="brand-name">J-Box</span>
        </div>
      </header>

      <section className="hero">
        <div className="container">
          <h1>Storefront and Field for small trade contractors.</h1>
          <p>
            This is the J-Box platform shell. Each customer&apos;s public site
            lives on its own subdomain, and the Field workspace is where staff
            run estimates, jobs, and invoices.
          </p>
          <p>
            Tenant sites are not set up yet — check back after onboarding.
          </p>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container">Powered by J-Box</div>
      </footer>
    </main>
  );
}
