# CURRENT_STATE

Repository: J-Box (JBox) monorepo. Branch `main`, commit `31fec639022251de183fdcf9dcd98abd12fd30dc`.
Working tree: clean (`git status --short` empty). Remote: `origin https://github.com/Excelsior2026/jbox.git`.
Produced: 2026-08-13 by the architecture-assurance pass. This file records verified state only; every
claim below was observed, not assumed. Where something could not be verified it is marked **UNVERIFIED**.

## 1. Deployment targets

| Target | Host / app | Evidence |
|---|---|---|
| Production (product) | Vercel project `jbox-product` (`prj_xY3rTpvj2eEip9UEe8sBtUApu3Cr`, team `bagel-tech`) → `usejbox.com` | `apps/product/.vercel/project.json`; `vercel whoami` = `billparris-1374`; `curl https://usejbox.com/api/health` → 200 |
| Production (control) | Vercel project `jbox-control` (`prj_6jhRirIsCuhNdRUbY56ZFw2sJVWI`) → `jbox-control.vercel.app` | `.vercel/project.json` (root, links to jbox-control); `apps/control/.env.example` `CONTROL_BASE_URL=https://jbox-control.vercel.app` |
| Development | local `.env.local` → Neon `development` branch (`br-square-wind-av4qdhvq`) of project `restless-meadow-35560667` | `docs/DATABASE_SETUP.md:20-32`; `.env.local` presence |
| Preview | `.env.neon.preview.local` → Neon `preview` branch (`br-floral-poetry-avcpaajg`) | `docs/DATABASE_SETUP.md:20-32` |
| Fly.io | **Not in use.** `fly.control.toml` / `fly.product.toml` are stale (build context, `apps/*/Dockerfile` exist) | `flyctl` not installed (`command not found`); production traffic verified on Vercel; `docs/DATABASE_SETUP.md` Fly references predate the Vercel move |

**No dedicated staging environment exists.** Vercel preview deployments exist but do not map to a defined
"staging" data environment; preview domain env on Vercel includes `FIELD_DEMO_MODE`, `DEVELOPMENT_FIELD_ORGANIZATION_ID`,
`NVIDIA_KEY` and inherits production DB credentials. Preview database wiring is **UNVERIFIED** (could not be pulled
without risk of altering values).

## 2. Database connection roles (verified against the live production branch)

Queried read-only on the production Neon branch 2026-08-13:

| Role | Type | Member of (production) | BYPASSRLS | Used by |
|---|---|---|---|---|
| `jbox_runtime` | LOGIN | `contractor_app`, `platform_runtime` | false | Product app (Storefront, Field, cron, health) via `DATABASE_URL_UNPOOLED` (direct endpoint, app-managed `pg.Pool`) |
| `jbox_control` | LOGIN | `contractor_app`, `control_app` | false | Control plane via `CONTROL_DATABASE_URL` |
| `jbox_owner` | LOGIN (Neon owner) | `neon_superuser`, all app roles | **true** | Migrations, verify, seed, provisioning — **local operator only** |
| `contractor_app` | NOLOGIN | — | false | `SET LOCAL ROLE` target for tenant-scoped work |
| `control_app` | NOLOGIN | — | false | `SET LOCAL ROLE` target for control-plane work |
| `platform_runtime` | NOLOGIN | — | false | `SET LOCAL ROLE` target for auth/cron/outbox windows |

**Discrepancy (HIGH):** `scripts/provision-neon-branch.mjs:187` creates `jbox_control` as member of
`control_app` **only**, while `docs/DATABASE_SETUP.md:161-164` and `docs/CONTROL_PLANE.md:14-15` require
`control_app` **and** `contractor_app`. Production was **hand-granted** `contractor_app` (verified above), but the
development branch's `jbox_control` is `{control_app}` only (verified read-only). On any branch provisioned by the
script, control-plane provisioning of tenant content (record counters, configuration, price book) would fail at the
`SET LOCAL ROLE contractor_app` boundary — currently masked because `apps/control/.env.local` points local control
development at the **production** control database, where the grant is correct.

`DATABASE_URL_OWNER` exists only in gitignored local files (`.env.local`, `.env.neon.production.local`,
`.env.neon.preview.local`) and is never set in any deployed environment (verified via `vercel env ls`).

## 3. Hosting responsibilities

- **Vercel Hobby plan** (confirmed by `vercel deploy --prod` refusal: "Hobby accounts are limited to daily cron jobs").
- Product app runs on Vercel with `output` default (standalone only for self-hosting); `apps/product/vercel.json` is the
  only committed Vercel config.
- Cron is the single background worker (see §4). No web worker, no message queue, no dedicated job server.

## 4. Cron / background-worker configuration

| Item | Value | Evidence |
|---|---|---|
| Cron schedule | `0 8 * * *` (daily 08:00 UTC) | `apps/product/vercel.json:4-5` |
| Cron route | `GET /api/cron/transactional-outbox` | `apps/product/src/app/api/cron/transactional-outbox/route.ts` |
| Auth | `Authorization: Bearer $CRON_SECRET`, SHA-256 pre-hash + `timingSafeEqual`; `<32` chars → 503 | `apps/product/src/lib/cron-auth.ts` |
| Drain | single claim batch, default limit 20, cap 50, no intra-run loop | `apps/product/src/lib/outbox-dispatch.ts:233-274` |
| Delivery gating | `isResendConfigured()` (`re_` prefix, ≥12 chars) checked at enqueue and dispatch | `apps/product/src/lib/outbox-dispatch.ts:18-21`, `estimate-delivery.ts:80-82` |
| RESEND_API_KEY | **NOT set on production Vercel** (verified `vercel env ls` + env pull) | → outbox is currently inert: `createEstimateDelivery` refuses before enqueue |
| CRON_SECRET / CUSTOMER_LINK_SECRET / FIELD_AUTH_SECRET / FIELD_PROVISION_SECRET | set on production Vercel | `vercel env ls production` |
| FIELD_DEMO_MODE | **set to `"1"` on production** | env pull, §7 |

## 5. Baseline test/lint/build results (2026-08-13)

- `npm test`: **25 test files, 194 tests, all pass** (product 17 files; control 3; domain 1; money 1; database 1;
  configuration 1; `packages/testing` has no test files, `--passWithNoTests`).
- `npm run lint`: clean (all workspaces, `--max-warnings=0`).
- `npm run build` / `build:all`: **not re-run in this pass** (baseline assumed; product built successfully at last deploy `31fec63`). **UNVERIFIED in this pass.**
- `npm run secrets:check` (committed-secret scan): rules cover private keys, Stripe/Clerk/Resend tokens, webhook secrets, Vercel blob, GitHub tokens, postgres URLs; **no committed secrets found** (scan of `git ls-files`).

## 6. Identity / auth deployment facts

- Native Field auth (Clerk replaced in `11dba1c`): scrypt password hashing (N=16384, r=8, p=1, keylen 32, salt 16B),
  HS256 JWTs (jose), `field_sessions` ledger (jti-keyed), live membership re-read per request via
  `staff_session_membership` SECURITY DEFINER.
- `.env.local` (development) sets **none** of `FIELD_AUTH_SECRET` / `FIELD_PROVISION_SECRET`; local dev Field access
  falls back to the `DEVELOPMENT_FIELD_ORGANIZATION_ID` development principal (`field-api-auth.ts:79-96`) whenever
  `NODE_ENV !== 'production'` and the org id is configured. See Phase 2 doc / findings.
- Production Vercel **does** set `FIELD_AUTH_SECRET`, `FIELD_PROVISION_SECRET`, `FIELD_DEMO_MODE="1"`,
  `DEVELOPMENT_FIELD_ORGANIZATION_ID`.

## 7. Live security findings (observed, not hypothetical)

- **CRITICAL — anonymous owner-level Field access on production.** `FIELD_DEMO_MODE="1"` + `DEVELOPMENT_FIELD_ORGANIZATION_ID`
  are set on the production Vercel project. Verified live: `GET https://usejbox.com/api/auth/me` (anonymous) → **401**
  (auth properly closed), but `GET https://api/field/estimates` (anonymous, no cookie) → **200 with real tenant data**
  (`DPE-0004`, `Lena Kowalski`, ...). The development-principal fallback (`field-api-auth.ts:79-96`) grants the demo
  organization's **owner** capability set to any anonymous visitor on production. Full details in `CROSS_LAYER_ASSURANCE_MATRIX.md`
  and `REMEDIATION_PLAN.md`.
- **HIGH — `claimed_until` outbox lease is dead code.** The 5-minute claim lease is set (`005_field_identity_and_customer_access.sql:479`)
  but never consulted by the claim predicate (`status IN ('pending','failed')` only). A crashed `claimed` row is
  unrecoverable; grep across `apps/`/`packages/` finds no reader of `claimed_until` outside migration 005.
- **HIGH — control-role provisioning drift.** `provision-neon-branch.mjs` grants `jbox_control` only `control_app`;
  production has both roles (hand-granted). Dev branch has only `control_app`. See §2.
- **MEDIUM — admin tooling has no production guard.** `migrate.mjs`, `verify.mjs`, `run-sql-check.mjs`,
  `seed-dev-tenant.mjs` connect wherever `DATABASE_URL_OWNER` points; none refuse a production host. `seed-dev-tenant.mjs`
  **commits** (no rollback). CI runs `db:verify` against a GitHub secret documented as disposable.

## 8. Tenant / config facts (production, read-only)

- Orgs: `paris-electric` (active, `db010ee7-cff4-44ca-8444-bcc969e607ba`, config v2 approved, contact.email
  `estimates@usejbox.com`), `harbor-electrical` (provisioning), `demo` (`54cf3748-fabe-4462-bc14-5beeff46c827`,
  active, "Demo Plumbing & Heating").
- Config versioning: `configuration_versions` with one-in-force partial unique index
  (`status='approved' AND superseded_at IS NULL`); v2 approved / v1 superseded for paris-electric was applied through
  the DB directly (documented in `PORTING_LEDGER.md`).
- Outbox: `transactional_outbox` with `pending/claimed/sent/failed/dead`, attempts cap 12, linear backoff
  `least(attempts,10)*60s`. No `email_deliveries` tracking table exists.

## 9. Open verification gaps (reported as UNVERIFIED)

- Production `FIELD_DEMO_MODE` value was pulled from Vercel (see §7); treat the demo org as exposed until remediation.
- Whether any production Vercel deployment maps to a non-production Neon branch (preview inheritance) — **UNVERIFIED**.
- `npm run build:all` in this pass — **UNVERIFIED**.
