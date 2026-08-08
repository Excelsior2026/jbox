# JunctionBox Platform
## Architectural Design Document

**Version:** 0.3
**Status:** Platform architecture — supersedes v0.2
**Platform name:** JunctionBox
**Platform apex:** `usejbox.com`
**Brand relationship:** A BagelTech product
**Reference tenant:** Paris Electric Inc., licensed electrical contractor, Suffolk County, New York
**Prepared by:** BDB Labs / BagelTech

---

## 0. What changed from v0.2

Version 0.2 described a bespoke digital platform built for one electrical
contractor. Its framing — *"Prepared for: Paris Electric Inc."* — described a
client engagement.

The system has evolved into one configurable JunctionBox codebase with a
separate public Portal, operator Control plane, host-based tenant resolution,
versioned per-organization configuration, a six-template public-site catalog,
subscription foundations, and public onboarding intake. Paris Electric is
organization #1 and the reference implementation, not a customer-specific
fork.

The first commercial conversion path is deliberately **dedicated managed
cloud**. Shared-database SaaS remains a second deployment profile, but it is
not a launch claim: migrations 041 and 042 and the adversarial isolation gates
must be completed and production-verified before a shared SaaS sale. The
JunctionBox Portal therefore collects a guided setup request and starts a
reviewed provisioning workflow; it does not represent public Checkout or
zero-touch shared-SaaS activation as live.

This document re-describes the system as what it is, and defines what remains
to be built to operate it at roughly 100 tenants.

Everything in §2 is implemented in source. Sections §4–§7 distinguish active
release blockers from proposed scale work.

---

## 1. Executive summary

JunctionBox lets a small trade contractor — initially electrical — replace
paper estimating and an absent or outdated web presence with two connected
surfaces:

- **Storefront:** a professional public website, selected from a catalog of
  six design templates and themed from the tenant's own brand configuration.
  It captures qualified service requests with structured detail and photos.
- **Field:** a tablet-friendly workspace where the contractor prices work from
  a private price book, produces branded estimates, captures signatures,
  converts approved estimates into jobs, and issues invoices and receipts.

Requests raised on the Storefront land directly in Field. One system, no
re-keying, no Word documents.

The commercial thesis is that the market — independent contractors with fewer
than ten field staff — is underserved by both cheap website builders (which
produce a site and nothing else) and full field-service management suites
(which are priced and scoped for fleets). The Platform sits between: a real
website plus exactly the back office a two-truck operation needs.

The design constraint from v0.2 still holds and still governs: **preserve the
contractor's authority, judgment, pricing control, and customer
relationships.** The Platform removes administrative repetition. It does not
take over the business.

---

## 2. Current architecture (implemented in source)

### 2.1 Three planes

The monorepo separates operator concerns from tenant concerns.

| Plane | Path | Audience | Responsibility |
|---|---|---|---|
| **Portal** | `apps/portal` | Prospective electrical contractors | `usejbox.com` marketing, six starting directions, AI-assisted guided setup, and signed onboarding handoff |
| **Control** | `apps/control` | BagelTech operators | Organization lifecycle, provisioning, onboarding requests, support grants, operator dashboard |
| **Product** | `apps/product` | Tenants and their customers | Storefront, Field, customer documents, billing, intake |

Shared code lives in `packages/`: `configuration` (organization config schema,
template catalog, host resolution), `onboarding` (the JunctionBox v1 public and
signed integration contracts), `database` (migrations, RLS checks), `domain`,
`billing`, `observability`, `ui`, `testing`.

The three planes are designed to deploy separately (`vercel.json`,
`vercel.control.json`, `vercel.portal.json`). Control and Product hold distinct
database roles. Migration 038 scopes control policies to the control role, so
the product runtime cannot read or write control-plane state.

### 2.2 Tenant resolution

Every request to the Product plane is resolved by hostname before any
application code runs (`apps/product/src/proxy.ts`):

1. Middleware reads the `Host` header.
2. `resolveOrganizationForHostname()` dispatches on deployment mode.
   - `saas` — queries `resolve_verified_organization(hostname)`, a
     SECURITY DEFINER function that returns an organization only for a
     *verified* hostname.
   - `dedicated` — matches against an environment allowlist.
3. On success, `x-organization-id`, `x-organization-hostname`, and
   `x-deployment-mode` are injected into the request headers.
4. On failure, the request terminates with **421 Misdirected Request**,
   `Cache-Control: private, no-store`, and `X-Robots-Tag: noindex, nofollow,
   noarchive`. An unassigned hostname never reaches application code and never
   gets indexed.

Clerk's authorized parties and CSP directives are computed per resolved
origin, so a tenant's authentication surface is scoped to that tenant's
hostname.

### 2.3 Isolation

Isolation is enforced in the database, not the application layer.

- Migration 015 establishes RLS across tenant-owned tables, keyed on
  `app_current_organization_id()`, which reads the `app.organization_id`
  session setting.
- Migration 016 sets tenant-scoped column defaults across ~25 owned tables and
  repartitions rate-limit keys per organization.
- Migration 037 completes the tenant relationship cutover.
- `packages/database/rls-check.mjs` and `rls-check`-adjacent scripts assert the
  policies hold.

Application code enters tenant context through
`runWithOrganizationContext()` / `enterOrganizationContext()`
(`organization-context-store.ts`), which sets the session GUC for the duration
of a request.

**A known defect in this mechanism is documented in §4.1 and must be resolved
before the second production tenant.**

### 2.4 Configuration

Each tenant's identity is a single validated JSON document, versioned and
approval-gated in `organization_config_versions` (migration 030). The runtime
loads only the highest `version_no` with `status = 'approved'`.

The schema (`packages/configuration/src/index.ts`) covers:

`identity` · `brand` (primary, accent, surface colors) · `assets` (hero,
service-area imagery) · `contact` · `domains` (canonical + additional
hostnames) · `serviceArea` · `services[]` · `safety` · `documents` (per-tenant
ID prefixes and template versions) · `tax` · `claims` (license and insurance
statements, individually approval-flagged) · `legal` (disclosure text and
versions) · `email` · `features` (per-tenant capability flags)

Two properties of this design are load-bearing and should be preserved:

- **Claims are approval-flagged.** A license or insurance statement renders
  only when the tenant has affirmatively approved its text. The Platform never
  publishes a regulatory claim on a contractor's behalf by default.
- **Config is versioned and immutable.** Changes create a new version rather
  than mutating the live document, so a rendered estimate can be tied to the
  exact configuration in force when it was issued.

### 2.5 Public-site templates

`packages/configuration/src/public-site-templates.ts` defines a versioned
catalog (`PUBLIC_SITE_TEMPLATE_CATALOG_VERSION = 1`) of six templates:

| ID | Name | Positioning |
|---|---|---|
| `heritage-craft` | Heritage Craft | Established, detailed, local |
| `modern-grid` | Modern Grid | Modern, precise, clear |
| `neighborly-warm` | Neighborly | Warm, familiar, helpful |
| `industrial-pro` | Industrial Pro | Direct, technical, capable |
| `premium-home` | Premium Home | Refined, calm, residential |
| `direct-response` | Direct Response | Visible, fast, action-led |

The catalog is `as const satisfies` a definition type, with runtime type
guards (`isPublicSiteTemplateId`, `isPublicSitePresentation`) validating stored
tenant selections against the catalog version. A tenant's stored presentation
cannot silently drift out of range when the catalog changes.

### 2.6 Field and commercial documents

Field covers the working lifecycle: price book with release governance
(migration 028), customers, estimates with durable versioning (010), jobs
(011), estimate-to-job association (012), internal invoices and payments (013),
and an invoice activation interlock (029) that prevents invoicing before the
governing approvals are in place.

Customer-facing estimate and invoice documents are served through
signed, rate-limited access tokens (`customer-access-tokens.ts`, migrations
023–027) rather than authenticated accounts — a customer approves an estimate
from a link without creating a login.

Outbound notification is a transactional outbox (`transactional-outbox.ts`,
migration 025 claim semantics) drained by cron, so a failed email cannot lose a
state transition.

### 2.7 Identity, billing, intake

- **Identity:** Clerk, with webhook sync into local authorization tables
  (migrations 019–022 cover authorization, event hardening, audit idempotency,
  and event ordering). Field additionally supports a legacy access-code session
  (HMAC-SHA256, `timingSafeEqual`) behind the `legacySharedAccess` feature flag.
- **Billing:** Stripe subscription lifecycle (migration 032), checkout and
  customer portal routes.
- **Intake:** migration 040 and the legacy BagelTech v1 integration remain
  intact. Migration 044 adds the canonical `usejbox.com` source, `JBX-*`
  receipts, exact `*.usejbox.com` hostname binding, and the separately signed
  `/api/integrations/v1/junctionbox/onboarding-requests` route. The shared
  `packages/onboarding` contract keeps the Portal and Control parsers aligned.
- **Support:** time-boxed contractor support-access grants (migration 039), so
  operators assist a tenant without standing access to tenant data.

---

## 3. Deployment modes

Two modes exist in the product architecture
(`DeploymentMode = 'saas' | 'dedicated'`).

**`saas`** — one Product deployment, one database, many organizations.
Hostnames resolve through the database and RLS is intended to enforce
isolation. This profile is gated, not commercially released, until the 041/042
rollout and complete two-organization adversarial suite pass in production.

**`dedicated`** — one deployment bound to one organization via
`DEFAULT_ORGANIZATION_ID` and a `DEDICATED_ALLOWED_HOSTNAMES` allowlist.

`dedicated` is the first sellable path and the profile emitted by the
JunctionBox onboarding v1 contract. It preserves one application, database,
storage, identity configuration, and domain boundary per contractor while the
shared profile is hardened. Every dedicated customer still receives the same
immutable application SHA; there are no customer forks.

---

## 4. Defects and risks in the current build

### 4.1 Tenant fallback in the default-organization function — BLOCKING

`migrations/016_tenant_namespaces.sql`:

```sql
CREATE OR REPLACE FUNCTION app_default_organization_id()
RETURNS uuid ... AS $$
  SELECT coalesce(
    app_current_organization_id(),
    '4332ed7c-8859-43cd-a47f-825b3e383c3d'::uuid   -- Paris Electric
  );
$$;
```

This function is the column `DEFAULT` for `organization_id` on approximately
25 tenant-owned tables. `app_current_organization_id()` reads
`current_setting('app.organization_id', true)`; the `true` argument returns
NULL for a missing setting rather than raising.

**Consequence:** any insert executed without tenant context set is silently
attributed to Paris Electric. No error is raised, no policy is violated, and
the resulting row carries a plausible audit trail. One new API route that
misses `runWithOrganizationContext()` is sufficient to trigger it.

This was a defensible bridge during the single-tenant to multitenant
migration. It is a cross-tenant data-integrity failure at scale.

**Required remediation, before tenant #2:**

1. New migration: redefine `app_default_organization_id()` to return
   `app_current_organization_id()` with no fallback.
2. Assert `organization_id NOT NULL` across all owned tables, so a missing
   context fails loudly at insert time.
3. Extend `rls-check.mjs` with a case asserting that an insert with no
   `app.organization_id` set raises rather than succeeds.
4. Audit every write path for context entry; add a lint or test-time guard
   that any handler touching an owned table runs inside organization context.

### 4.2 Presentation and brand are not connected

`PublicSitePresentation` is `{ templateId, catalogVersion }`. The brand tokens
in `OrganizationConfig` (`brand.primaryColor`, `accentColor`, `surfaceColor`,
`assets.*`, `identity.logoPath`) are not referenced by the presentation
contract, and the brand axis itself is thin — three colors and two images, no
typography, spacing, or imagery treatment.

Six templates across 100 tenants means roughly seventeen tenants per template.
Regional clustering makes visual collision between direct competitors likely.
Template choice alone is not differentiation.

**Proposed:** bump the catalog to version 2 and extend presentation to
`{ templateId, catalogVersion, brand: { palette, typeScale, logoTreatment,
heroTreatment } }`, with templates consuming tokens rather than hardcoding
values. The existing catalog-versioning discipline makes this migration safe.

### 4.3 Catalog-to-CSS coupling

`previewClass: 'heritage'` binds the configuration package to CSS class names
in the Product app through an untyped string. Renaming a stylesheet class
breaks rendering with no compile-time error. Generate the class names from the
template ID, or type the relationship.

### 4.4 Default template

`DEFAULT_PUBLIC_SITE_PRESENTATION` is `heritage-craft`. Every unconfigured
tenant boots looking like the reference tenant. Template selection should be a
required step in provisioning rather than a silent default.

### 4.5 Reference tenant still hosted on the parent brand's domain

Paris Electric's canonical hostname is still `pariselectric.bageltech.net`.
The product boundary is now resolved at `usejbox.com`, and new platform
subdomains use `<organization>.usejbox.com`. Moving the reference tenant is a
separate verified-domain migration; no application path may silently rewrite
its live hostname.

### 4.6 Row level security is enabled but never forced — BLOCKING

Fifteen `ENABLE ROW LEVEL SECURITY` statements exist across migrations 015, 038
and others. Zero `FORCE ROW LEVEL SECURITY` statements exist.

In PostgreSQL, `ENABLE ROW LEVEL SECURITY` does not constrain the table owner.
The owner bypasses every policy unless `FORCE` is also set. Isolation is
therefore only as strong as the role the application authenticates as.

`apps/product/src/lib/db.ts` exposes two clients:

- `db()` — scoped. Every query runs in a transaction opening with
  `SET LOCAL ROLE contractor_app` and `set_application_context()`. Correct.
- `routingDb()` — unscoped. Returns the raw client with no role switch and no
  organization context. Used by webhook handlers, the cron drain, health, and
  hostname resolution, all of which are legitimately cross-tenant.

`routingDb()`'s isolation depends entirely on which role `DATABASE_URL`
authenticates as. Migration 042 addresses this and documents the pre-flight
check; it is deliberately separate from 041 because its blast radius is wider.

**Open question only an operator can answer:** does production's `DATABASE_URL`
still authenticate as `neondb_owner`, or as the restricted `contractor_app`
login that `.env.example` prescribes? If the former, RLS is currently inert in
production. `SELECT current_user, session_user;` answers it.

### 4.7 Local and preview share one database, connected as owner

`.env.local` and `.vercel/.env.preview.local` point at the identical Neon
endpoint (`ep-floral-dream-avstsfkj`, us-east-1), both as `neondb_owner`.

Two consequences. Local development writes land in the same database preview
deployments read and write, so a destructive local experiment is a preview
outage. And because that role owns the tables, §4.6 applies in full: RLS is
inert in both environments, meaning tenant isolation cannot be meaningfully
tested in either.

Neon branching is the intended fix — a branch per environment, and ephemeral
branches for preview deployments — with a restricted role for application
connections in every environment, not only production.

---

## 5. Scaling to ~100 tenants

The constraint at 100 tenants is not compute. A hundred contractors running a
few dozen estimates a month is a small workload for one Postgres instance and
one Next.js deployment. The constraints are **domains**, **provisioning
labour**, **support labour**, and **blast radius**.

### 5.1 Domain strategy

Each tenant needs a public web address. Three tiers, in ascending cost:

**Tier 1 — Platform subdomain (default).**
`acme-electric.<platform-apex>` — issued automatically at provisioning,
resolved by a wildcard DNS record and a wildcard TLS certificate. No customer
action, no waiting on DNS propagation, no per-domain certificate issuance. A
tenant is live minutes after signup. This is how the Platform reaches 100
tenants without the operator touching DNS.

Requires: a dedicated platform apex domain (§4.5), wildcard DNS, and wildcard
TLS. `resolve_verified_organization()` already supports this — the subdomain is
simply pre-verified at creation.

**Tier 2 — Tenant's own domain (paid tier or standard, per pricing).**
`pariselectricli.com` — the tenant delegates via CNAME or A record, the
Platform verifies ownership through a DNS TXT challenge, then a per-domain
certificate is issued. The `verifiedHostname` concept and `additionalHostnames`
array already model this.

This tier is where scale problems appear, and they must be verified against
current provider limits before committing:

- **Domains per project.** Hosting providers cap custom domains per project.
  Confirm the current limit on the target plan; if 100 custom domains exceeds
  it, the options are multiple projects behind a router, or terminating TLS at
  a proxy under Platform control.
- **Certificate issuance rate limits.** Public CAs rate-limit issuance per
  registered domain and per account. Bulk onboarding — a trade-association
  deal bringing 30 contractors at once — can hit these. Stagger issuance.
- **Renewal failure is a tenant outage.** A silently failed renewal takes a
  contractor's website down. Certificate expiry must be monitored per tenant
  with alerting well ahead of expiry, not discovered by the tenant.

**Tier 3 — Full nameserver delegation.** Rare, high-touch, enterprise only.
Do not build until a signed deal requires it.

**Recommendation:** ship Tier 1 as the universal default so every tenant is
live immediately, and treat Tier 2 as a post-activation upgrade the tenant
requests once they are committed. This decouples "tenant is live" from "DNS is
correct," which is the single largest source of onboarding delay in this
category of product.

### 5.2 Provisioning

The current dedicated procedure is intentionally reviewed and human-gated.
The Portal removes the blank-form problem without pretending external
resources already exist:

1. A contractor at `usejbox.com` chooses one of six starting directions,
   supplies colors and business details, and uses the AI-assisted studio to
   produce a constrained website blueprint.
2. The Portal validates the public v1 contract, signs the exact integration
   payload, and hands it to the Control plane.
3. Migration 044 stores a source-bound, immutable request with a `JBX-*`
   receipt. A replay with the same idempotency key and payload is safe; changed
   details conflict.
4. A platform administrator reviews the business details, services, domain,
   colors, and generated copy. Acceptance creates the dedicated organization
   and opens provisioning gates; it does not bypass them.
5. DNS, sender domain, Clerk owner, database, private storage, secrets,
   backups, and smoke tests remain explicit evidence gates before activation.

Public Stripe Checkout and subscription-triggered zero-touch provisioning are
future commercial automation. They must reuse the reviewed intake artifact and
must not activate a contractor merely because a payment webhook arrived.

Two design points matter here. First, **trade presets are the difference
between a ten-minute setup and an empty form** — a new electrical tenant
should start with six populated service categories and a defensible starter
price book, not a blank JSON document. Second, **claims stay unapproved until
the tenant affirms them** (§2.4); automation must not approve a license
statement on a contractor's behalf.

### 5.3 Configuration at scale

Hand-editing a 3KB JSON config 100 times is not viable. Control needs a config
editor UI that writes new versions through the existing approval gate. The
schema, versioning, and validation already exist — this is a UI over
`organization_config_versions`, not new architecture.

Add: config diffing between versions, rollback to a prior approved version,
and bulk migration tooling for when the config schema version increments
across all tenants at once.

### 5.4 Support and operations

One hundred contractors generate support load that will exceed development
time if it is not instrumented.

- **Error attribution by tenant.** Every log line, exception, and trace must
  carry `organization_id`. "Estimates are broken" must be answerable as "for
  this tenant" or "for everyone" within one query. `packages/observability`
  is the place for this.
- **Per-tenant health.** Domain resolving, certificate valid and days to
  expiry, config approved, subscription current, outbox draining, last
  successful login. Surface as a Control dashboard grid, not per-tenant
  investigation.
- **Support access.** The time-boxed grant flow (039) is already the right
  model. Enforce it — operators should have no standing read access to tenant
  business data.
- **Self-service billing.** The Stripe portal is wired; make it the only path
  for plan changes, payment method updates, and cancellation.
- **Status page and incident comms.** At 100 tenants an outage means 100
  phone calls unless there is somewhere to point them.

### 5.5 Capacity and fairness

Not throughput problems, but multi-tenant fairness problems:

- **Connection pooling — already correct, do not regress.** Tenant context is
  transaction-scoped, not session-scoped: `set_application_context()` uses
  `set_config(..., true)`, and every scoped query runs inside a transaction
  opening with `SET LOCAL ROLE contractor_app` (`apps/product/src/lib/db.ts`).
  Combined with the Neon serverless driver's HTTP transport, this is safe under
  transaction pooling and does not exhaust connections. **The constraint this
  creates is a rule, not a task: any future data access that bypasses the
  scoped client — a raw `neon()` call, a background worker, a direct
  `routingDb()` write — loses tenant context and is unsafe. Route all
  tenant-owned access through the scoped client.**
- **Cron fairness.** The outbox and notification crons iterate all tenants.
  One tenant with a large backlog must not starve the other 99. Batch with
  per-tenant caps and round-robin claiming.
- **Rate limits.** Already partitioned per organization (016). Confirm the
  storage-upload and intake limits are per-tenant, so one tenant's traffic
  spike cannot exhaust a shared budget.
- **Backups and restore.** `docs/BACKUP_AND_RESTORE_RUNBOOK.md` exists;
  extend it with **single-tenant restore**. Restoring one contractor's data
  without rolling back the other 99 is the scenario that will actually occur.

---

## 6. Commercial model

Not yet decided; recorded here because it constrains architecture.

**Likely shape:** a flat monthly subscription per contractor, with the Tier 1
subdomain included and a custom domain either included or a small uplift. A
`dedicated` deployment is an enterprise line item priced to cover its
operational cost.

Architectural implications regardless of final pricing:

- **Feature flags already exist** (`features.*` in the config) and can express
  plan tiers without code branching. Keep tier logic in configuration.
- **Avoid per-seat pricing** for this segment. A two-truck contractor adding a
  helper should not face a pricing decision; per-seat billing suppresses the
  usage that makes the product sticky.
- **Avoid usage-metered estimates.** Metering the core action discourages the
  behaviour the Platform exists to encourage.
- **Data export is a retention feature, not a risk.** `data-exports.ts` exists.
  Making export easy lowers the perceived cost of adoption for a contractor
  whose records are currently on paper they control.

---

## 7. Sequencing

**Phase 1 — Dedicated first sale.**
Operate `usejbox.com` as the JunctionBox Portal, apply the selected 040/043/044
intake sequence without 041/042, verify the signed handoff, and provision a
second dedicated contractor from one reviewed request without source changes.
Complete identity, domain, sender, private storage, backup, and smoke-test
gates before activation.

**Phase 2 — Shared SaaS correctness.**
Remove the tenant fallback (§4.1), require tenant ownership columns, roll out
041/042 after role preflight, and pass the complete two-organization
adversarial RLS/hostname/background-job suite. Only then expose the shared
profile commercially.

**Phase 3 — Tenth organization survivable.**
Config editor in Control. Per-tenant health dashboard. Tenant-attributed
observability. Connection pooling verified against the session GUC. Cron
fairness. Single-tenant restore.

**Phase 4 — Hundredth organization sustainable.**
Brand token layer and catalog v2 (§4.2). Custom-domain self-service with
verification and certificate monitoring. Status page. Guided setup flow.
Second trade vertical, if the thesis holds.

The ordering is deliberate: correctness before growth, automation before
volume, differentiation last. Template differentiation matters at 40 tenants;
silent cross-tenant writes matter at 2.

---

## 8. What this document does not cover

- The AI Project and Safety Assistant described in v0.2 §1. Present in the
  Storefront concept; not re-specified here.
- TruePresence identity and completion verification (v0.2, optional).
- Scheduling and dispatch. Deliberately out of scope — it is the boundary
  between this Platform and a field-service management suite, and crossing it
  changes the product, the competition, and the price point.
- Multi-trade expansion beyond electrical. The configuration schema is
  trade-agnostic; the price-book presets, safety rules, and template copy are
  not.

---

## 9. Open decisions

**9.1 Platform name — RESOLVED.** The platform is **JunctionBox**, apex domain
`usejbox.com`, endorsed as **A BagelTech product**. Surface naming follows the
structural split: **JunctionBox Portal** (`apps/portal`), **JunctionBox
Control** (`apps/control`), **JunctionBox Storefront** (contractor public
sites), and **JunctionBox Field** (`/field`).

The internal npm scope stays `@contractor-platform/*`. It describes what the
code is rather than what customers buy, it remains accurate across trade
verticals, and keeping brand decoupled from package identity is precisely the
property that made this rename cheap. Do not rename the scope.

**9.1a Wildcard TLS is a sequencing constraint.** The Tier 1 subdomain tier
requires a wildcard certificate for `*.usejbox.com`.

- Wildcard certificates require the DNS-01 ACME challenge; HTTP-01 cannot
  validate them. The DNS zone must therefore be delegated to a provider that
  can write challenge records programmatically, which for this stack means
  delegating nameservers to Vercel rather than pointing an A record at it from
  the registrar. Registrar of record is Spaceship, Inc.
- A wildcard covers exactly one label. `acme.usejbox.com` is covered;
  `field.acme.usejbox.com` is not. **Keep tenant hostnames at a single level.**
  The current structure already satisfies this — `/field` is a path, not a
  subdomain — so this is a property to preserve rather than a change to make.
- Local multi-tenant subdomain testing needs locally trusted certificates.
- Certificate renewal failure is a tenant outage. Monitor expiry per hostname.

**9.1b Tier 1 subdomains are staging, not a permanent home — revises §5.1.**
`pariselectric.usejbox.com` reads as a platform URL rather than the web address
of an established local business. For a Storefront whose entire purpose is
projecting credibility to a homeowner comparing three contractors, that is a
real cost.

Tier 1 should therefore be repositioned from *permanent default* to
*immediate-activation address*, with migration to the tenant's own domain
(Tier 2) treated as a required onboarding step rather than an optional
upgrade. This raises the priority of custom-domain self-service tooling from
Phase 4 to Phase 2, and it resolves §9.2: custom domains are included, not an
upsell.

Vercel ships Platform Elements (`CustomDomain`, `DomainConfiguration`,
`DNSTable`) and `domains.getDomainConfig()` in the SDK covering most of this
flow. Evaluate before building domain verification UI from scratch.

**9.3 Reference tenant relationship.** Paris Electric is both tenant #1 and
the design reference. Its configuration should be treated as production data,
not as a fixture. Migration 035 seeds it, and several tests reference it by
name; those couplings should be reviewed so the reference tenant can be
changed or removed without breaking the suite.

**9.4 Second vertical.** Whether the next tenants are more electricians
(deeper presets, network effects in one trade) or an adjacent trade (broader
market, thinner presets). This determines whether the price-book preset work
in Phase 2 is one investment or several.

---

*Supersedes `paris-electric-platform-design-v0.2.md`, retained for history.*
