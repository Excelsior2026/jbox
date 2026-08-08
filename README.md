# J-Box

A multitenant operating platform for small trade contractors — initially electrical.

Two connected surfaces replace paper estimating and an absent or outdated web presence:

- **Storefront** — a professional public website, selected from a template catalog and themed
  from the tenant's own brand configuration. Captures qualified service requests with
  structured detail and photos.
- **Field** — a tablet-friendly workspace where the contractor prices work from a private price
  book, produces branded estimates, captures signatures, converts approved estimates into jobs,
  and issues invoices and receipts.

Requests raised on the Storefront land directly in Field. One system, no re-keying.

The market — independent contractors with fewer than ten field staff — is underserved by both
cheap website builders (which produce a site and nothing else) and full field-service management
suites (priced and scoped for fleets). J-Box sits between: a real website plus exactly the back
office a two-truck operation needs.

**The governing design constraint:** preserve the contractor's authority, judgment, pricing
control, and customer relationships. The platform removes administrative repetition. It does not
take over the business.

## Status

Early. This repository is a selective fresh start from a working single-tenant prototype
(`paris-electric-prototype`), which continues to serve the reference tenant while this one is
built. See [Porting Ledger](docs/PORTING_LEDGER.md) for what carries across and what
deliberately does not.

Paris Electric Inc. (Suffolk County, New York) is tenant #1 and the design reference — not the
customer.

## Documentation

- [Platform design v0.3](docs/architecture/platform-design-v0.3.md) — architecture, scaling
  model, commercial model, and open decisions. Inherited from the predecessor; its §4 (defects)
  is superseded by the porting ledger.
- [Porting Ledger](docs/PORTING_LEDGER.md) — what to port, what not to, and the four decisions
  that must be settled before the first migration.

## Principles carried forward

These are load-bearing and were expensive to learn:

- **Isolation is enforced in the database, not the application layer.** Row-level security,
  enabled *and* forced, with the runtime connecting as a restricted non-owner role that assumes
  a tenant-scoped role per transaction. An application path can forget to enter tenant context;
  it cannot forget a database policy.
- **Regulatory claims are approval-flagged.** A license or insurance statement renders only when
  the tenant has affirmatively approved its text. The platform never publishes a claim on a
  contractor's behalf by default.
- **Configuration is versioned and immutable.** Changes create a new version rather than mutating
  the live document, so a rendered estimate ties to the exact configuration in force when it was
  issued.
- **Money is integer cents, server-authoritative.** No floats anywhere in the pricing path.
- **Unpublished pricing cannot enter a commercial document.**

## Scope boundaries

Scheduling beyond appointment booking — dispatch boards, capacity and travel optimization — is
deliberately out of scope. It is the boundary between this platform and a field-service
management suite, and crossing it changes the product, the competition, and the price point.

Go-live is gated on legal review (NY GBL Art. 36-A escrow, §396-t cooling-off, Suffolk HIC
license number, ST-124). AI review is not legal sign-off.
