# Porting Ledger

What comes across from `paris-electric-prototype`, what does not, and why.

This repository is a **selective fresh start**, not a fork. The predecessor remains the
system of record for Paris Electric until this repository can serve it, and it keeps the
full commit history — nothing is being deleted there.

## The finding that shaped this decision

Measured against the production Neon database on 2026-08-08. Of **56 tables, 43 are empty**,
and the 13 that are not contain nothing transactional:

| Table | Rows |
|---|---|
| `organizations`, `organization_config_versions`, `organization_domains`, `organization_memberships`, `platform_users` | 1 each |
| `price_books`, `price_book_releases` | 1 each |
| `price_book_categories` | 5 |
| `price_book_items`, `price_book_item_versions` | 17 |
| `organization_record_counters` | 5 |
| `service_request_rate_limits` | 2 (ephemeral) |
| `_migrations` | 39 |

**Zero** customers, estimates, jobs, invoices, payments, service requests, subscriptions, or
webhook events. Paris Electric has never transacted through the platform. The entire real
payload is one organization configuration and a 17-item price book.

That changes the economics of every open defect. The predecessor carries a queue of
multi-tenancy remediation — a hardcoded tenant fallback in a column default, `ENABLE ROW LEVEL
SECURITY` with no `FORCE`, a runtime that connects as a `BYPASSRLS` table owner, and six primary
keys with `^PE-` baked into their `CHECK` constraints. Every one of those exists because
single-tenant decisions were made first and multi-tenancy arrived later.

None of it needs remediating here. It needs **not being written**.

## Port

| Item | Notes |
|---|---|
| `docs/architecture/platform-design-v0.3.md` | Canonical design. §1, §5, §6, §9 carry over intact. **§4 (defects) is obsolete here** — superseded by this ledger. |
| Money module | Integer-cents arithmetic with `divRoundHalfUp`. Hard-won; a float leaked into the taxable-discount step once and was caught by review. |
| Document/contract modules | `customer-contract.ts` limit constants mirroring DB CHECKs, hand-rolled validators. |
| Price-book release governance | Draft → validate → review → publish, provenance-bearing. Unpublished pricing cannot enter a commercial document. Port the model; renumber the migrations. |
| Foreman safety triage | `foreman-triage.ts` + its vitest suite. Real false-negatives were found and fixed here ("sparks", "got shocked"); do not rewrite from scratch. |
| Customer access tokens | Hashed, scoped, expiring, revocable, version-bound links. Approval single-use and idempotent. |
| Transactional outbox | Durable delivery with claim semantics, drained by cron. |
| Configuration schema | **Ported** (`packages/configuration`, migration 003). Versioned, approval-gated, immutable. The predecessor's **approval-flagged claims** are deliberately out of scope here: product scope drops the claims system, and the schema is built to keep regulatory language out even if it returns. |
| Public-site template catalog | **Ported** (`packages/configuration/src/templates.ts`). Six templates, `as const satisfies`, runtime type guards, catalog versioning, theme class derived from template id so the CSS binding cannot drift. |
| `platformDb()` role-switched client | Written for the predecessor's Phase 1; belongs here from day one. See below. |
| Verification discipline | `verify:ci` chain, `db:*:check` scripts, secret scanning. |

## Do not port

| Item | Reason |
|---|---|
| `^PE-` prefix `CHECK` constraints on six primary keys | The specific defect that makes tenant #2 unable to transact. Document ids get a tenant-scoped identity model from migration 001. |
| `app_default_organization_id()` tenant fallback | `coalesce(current_setting(…, true), '<Paris uuid>')` as a column default silently misfiles any write made outside tenant context. Never introduce it; require context from the start. |
| Migrations 001–045 as a lineage | 45 files, several of which exist only to undo earlier ones (041 unwinds 016; 042 patches 015). Design the schema once, correctly. |
| `dedicated` deployment mode as the default | v0.3 §3: it currently reads as the primary path and is the local-development default. It should be a priced enterprise option, never the standard onboarding path. |
| `routingDb()` | Raw client whose isolation depended entirely on which role `DATABASE_URL` authenticated as. Replaced by `platformDb()`. |
| Paris-specific legacy shared access | `PARIS_LEGACY_SHARED_ACCESS_ENABLED`, `FIELD_ESTIMATOR_ACCESS_CODE` — a migration bridge for one tenant. |
| Prototype commit history | Retained in the predecessor. |

## Decide before writing migration 001

These are open and should not be settled by default:

1. **Document identity.** The predecessor used a global text PK (`PE-EST-0042`) with a
   per-organization counter, which collides across tenants the moment two exist. Options: a
   composite `(organization_id, document_number)` key with a surrogate uuid PK, or a
   tenant-prefixed id where the prefix is a reserved resource validated at provisioning.
   The customer-facing *display* id and the database *key* need not be the same value.
2. **Whether the runtime login is ever the table owner.** Recommended: never. Owner is used by
   migrations only; the app connects restricted and assumes `contractor_app` or
   `platform_runtime` per transaction.
3. **`FORCE ROW LEVEL SECURITY` on every RLS table from the start**, so `ENABLE`-without-`FORCE`
   never becomes a latent gap.
4. **Database-per-environment.** The predecessor has local, preview, and production pointed at
   one Neon endpoint as owner, so local development writes to production. Branch per
   environment before the first deploy.

## Data migration

One organization config and a 17-item price book. Re-seed rather than migrate: export the price
book to the new schema's import format and re-approve the configuration. There is no customer,
estimate, invoice, or payment data to preserve.

## Post-port additions

Not prototype ports — new capabilities built in this repository after cutover began:

| Item | Notes |
|---|---|
| Internal invoice from a signed estimate | Migration `012`, `apps/product/src/lib/invoices.ts` + `/api/field/invoices`. One invoice per estimate (partial unique index), header + lines copied inside a guarded CTE that never touches the estimate row, persisted totals, `invoice_events 'created'` + `estimate_events 'invoice_created'`, idempotent `reused:true` on repeat. Estimate list derives a read-only `invoiceId`; field invoices carry `invoices.read` / `invoices.open` capabilities. Shipped `63b59a3` and deployed to Vercel production. |

## Deployment status

Both apps are deployed on Vercel (team `bagel-tech`); production points at the protected (once
Neon protection is enabled) `production` branch.

- **Product** — `jbox-product`, `usejbox.com` (auto-deploys on git push). Env wired: DB URLs,
  control-plane URL, cron/customer-link/field/provision secrets, `NVIDIA_API_KEY`.
- **Control** — project `control` (rootDirectory `apps/control`), `control.bageltech.net`,
  deploy from the repo root (`vercel --prod`). Env: `CONTROL_DATABASE_URL`, `CONTROL_API_TOKEN`.
- Runtime-verified 2026-08-15: product `/api/health` and control `/api/health` both 200 with DB
  + schema checks; control `/api/organizations` returns orgs with the bearer token and 401s
  without. The `demo` org it returns is the same `DEVELOPMENT_FIELD_ORGANIZATION_ID` the product
  uses for field demo mode.

The Fly configs (`fly.product.toml`, `fly.control.toml`) and the DATABASE_SETUP.md Fly section
are stale; Vercel is the deployment target.


`paris-electric-prototype` continues to serve Paris Electric in `dedicated` mode
(`/api/health` reports `deploymentMode: "dedicated"`, `schemaVersion: "039"`) and is
five migrations behind its own `main`. Leave it running. Cut over only when this repository can
serve the same tenant, and treat that cutover as its own planned exercise.
