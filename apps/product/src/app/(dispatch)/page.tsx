import Link from 'next/link';

export default function DispatchPortalHomePage() {
  return (
    <>
      <div className="dispatch-banner">
        Licensed &amp; Insured Trade Operations &bull; Live Field Dispatch
      </div>

      <main className="dispatch-hero">
        <div className="dispatch-badge">
          Commercial &amp; Residential Service Operations
        </div>

        <h1>
          Built-Right Trades.<br />
          <span className="accent">Clear Bids. Fast Response.</span>
        </h1>

        <p className="subdeck">
          Request service calls, approve scope bids, and track field
          technicians en route to your job site.
        </p>

        <div className="dispatch-cta-row">
          <Link href="/dispatch/request" className="dispatch-btn dispatch-btn-primary">
            Submit Service Request
          </Link>
          <Link href="/dispatch/track" className="dispatch-btn dispatch-btn-secondary">
            Track En-Route Tech
          </Link>
        </div>
      </main>
    </>
  );
}
