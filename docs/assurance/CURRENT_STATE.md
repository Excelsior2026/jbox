# Current state

Assurance snapshot: 2026-08-14

Repository: `Excelsior2026/jbox`

Branch/commit: `main` at `ca9472238c73d5d92a8ab4cc87e84ff31e8ca0af`, exact `origin/main` at review start

This file records observed state. It is not a production-readiness approval. See `CROSS_LAYER_ASSURANCE_MATRIX.md`, `SIGNED_ESTIMATE_INVARIANTS.md`, and `REMEDIATION_PLAN.md` for conclusions.

## Deployment

| Surface | Observed target | State |
|---|---|---|
| Product | Vercel project `jbox-product`, domains including `usejbox.com` and `field.usejbox.com` | Production deployment `dpl_7hkcBDmeAD9soi7R4GcP1UiWhUjV`, `READY`, exact reviewed commit |
| Control | Vercel project `jbox-control`, `jbox-control.vercel.app` | Production deployment `dpl_DTc3dAJhDciYLVzy5A3eikvxN8E6`, `READY`, exact reviewed commit |
| Duplicate control link | Vercel project `control` from `apps/control/.vercel/project.json` | Latest production deployment failed; not the live control domain |
| Fly manifests | `fly.product.toml`, `fly.control.toml`, Dockerfiles | Stale relative to the verified Vercel deployment; storage comments still assume Fly |

Vercel runs Node 24. CI declares Node 22. The review machine ran Node 26. The root engine constraint is only `>=22`.

## Live production checks

Non-mutating requests made without cookies on 2026-08-14:

| Host/path | Result |
|---|---|
| `usejbox.com/api/auth/me` | 401 `unauthenticated` |
| `usejbox.com/api/field/estimates` | 200, four records |
| `field.usejbox.com/api/auth/me` | 401 `unauthenticated` |
| `field.usejbox.com/api/field/estimates` | 200, four records |
| Both hosts `/api/health` | 200 |

The mismatch is caused by `FIELD_DEMO_MODE` plus the configured development organization ID in Production. `field-api-auth.ts:79-101` turns a missing/invalid JWT into an owner principal. Treat the configured tenant data as anonymously exposed until containment and audit are complete.

## Environment inventory

Product Production has database, field-auth, staff-provision, customer-link, cron, and control-plane variables. It also has the two demo-principal variables. It does **not** have `RESEND_API_KEY`, so estimate email delivery fails closed before enqueue.

Product Preview has only `FIELD_DEMO_MODE`, `DEVELOPMENT_FIELD_ORGANIZATION_ID`, and `NVIDIA_KEY`. It has no database or auth/customer-link/control-plane secrets. Code reads `NVIDIA_API_KEY`, so `NVIDIA_KEY` does not activate the AI path.

The actual gitignored `apps/control/.env.local` points local control development at the production Neon branch. Root `.env.local` points product/database tools at development. This violates the branch-per-environment decision and creates an accidental production-write path.

## Database branches, roles, and migrations

| Branch | Applied migrations | `jbox_control` membership |
|---|---|---|
| Development | 001-008 | `control_app` only |
| Preview | 001-002 | `control_app` only |
| Production | 001-008 | `control_app`, `contractor_app` |

Production `jbox_runtime` is a non-owner login, has `rolbypassrls=false` and `rolinherit=false`, and may assume `contractor_app` and `platform_runtime`. These are good properties.

`scripts/provision-neon-branch.mjs:180-188` creates `jbox_control` without the `contractor_app` membership required by `control-db.ts:85-91`; production was hand-corrected, development/preview were not.

The privileged-function boundary is not narrow in either development or production. PostgreSQL's default `PUBLIC EXECUTE` was never revoked. Read-only privilege checks confirmed `contractor_app` can execute hostname resolution, all native-auth lookup/provision functions, and both outbox claim/finish functions.

## Tests and CI

With the concurrent uncommitted fixture allowlist edit in `scripts/secret-scan.mjs`, `npm run verify:ci` passes:

- secret scan: 190 tracked files;
- lint: all workspaces;
- tests: 26 files, 211 tests;
- control and product production builds;
- production dependency audit: zero known vulnerabilities at the configured threshold.

The original commit's secret scan fails on a synthetic localhost PostgreSQL URL in `apps/control/src/lib/control-db.test.ts:29`.

The remote quality workflow is not executing. `.github/workflows/quality.yml:30` references a secret directly in a job-level `if`, which GitHub does not allow. Run `31746920496` failed with zero jobs; the latest 12 runs inspected failed immediately. Therefore no current remote quality or isolation gate exists.

`npm run db:verify` exits successfully for all six suites on development. That green result is misleading for the outbox: `isolation-adversarial.sql:412-449` deliberately confirms that expired claims cannot be reclaimed, emits a defect notice, and passes.

## Current production capabilities

| Capability | Observed state |
|---|---|
| Storefront/tenant hostname resolution | Active; unknown/unverified hosts fail closed in reviewed code |
| Field native auth | Implemented, but bypassed by production demo fallback |
| Customer bearer links | Implemented; HMAC/purpose/tenant/expiry binding and hash-only storage |
| Estimate email | Disabled because provider key is absent; queueing fails closed |
| Background drain | Daily Vercel cron, one batch default 20; crash lease is broken |
| Photo intake | Code writes a Fly volume/local directory; incompatible with Vercel Functions |
| Signed-estimate history | Terminal estimate rows exist; exact rendered artifact/config is not frozen |
| Observability | Vercel logs and `console.error`; no tenant-attributed structured telemetry or alerts found |

## Working-tree note

The checkout began clean. During the review, an uncommitted one-line allowlist edit appeared in `scripts/secret-scan.mjs`; it is treated as concurrent user-owned work and was preserved. The assurance documents are additional review changes. No application, migration, database, Vercel, or GitHub setting was changed by this review.
