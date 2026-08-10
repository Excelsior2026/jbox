# Database Setup

How to stand up J-Box's Neon project, branches, and roles.

Everything here is done **once per environment**. Login roles remain out of migrations,
but `scripts/provision-neon-branch.mjs` automates their safe creation: it generates credentials
in memory, creates the roles through SQL, validates the role boundary, and writes only
gitignored local files with mode `0600`. It never prints credential values.

## Use a new Neon project, not the predecessor's

The prototype's project is `proud-forest-86717198`, and its single endpoint
(`ep-floral-dream-avstsfkj`) is currently serving Paris Electric in production while also
being what `.env.local` and Vercel preview point at. J-Box gets its own project so that
neither system can affect the other, and so the prototype keeps running untouched during
the cutover.

## Current provisioned state

Provisioned on 2026-08-08 in the direct **BagelTech** Neon organization:

| Resource | ID / value |
|---|---|
| Project | `restless-meadow-35560667` (`jbox`) |
| Region | `aws-us-east-1` |
| PostgreSQL | 17 |
| Database | `jbox` |
| Production branch | `br-quiet-band-avc4s183` (default) |
| Preview branch | `br-floral-poetry-avcpaajg` |
| Development branch | `br-square-wind-av4qdhvq` |
| Applied schema | `001` + `002` on **all three** branches, tracked in `_migrations` |

All three branches have distinct owner, runtime, and control credentials. Production and
preview credentials are retained only in gitignored `0600` operator files;
development credentials are merged into `.env.local`. No owner credential is configured in
any deployed environment.

**Migration ledger — resolved 2026-08-08.** All three branches are under
`packages/database/migrate.mjs` and report `up to date`. The hand-applied `001` was recorded
with `--adopt=001_foundation.sql` (records without executing), then `002` was applied through
the runner. From here, use the runner and never `psql -f` a migration:

```bash
npm run db:status                                  # development
npm run db:migrate
node --env-file-if-exists=.env.neon.preview.local    packages/database/migrate.mjs
node --env-file-if-exists=.env.neon.production.local packages/database/migrate.mjs
```

Production verified read-only after `002`: 8 tables, **0** RLS-enabled-but-not-forced, **0**
roles holding `BYPASSRLS`, **0** nullable `organization_id`, 0 business rows. The destructive
check suites were run against development and preview only.

**Verified against the development branch on 2026-08-08** (Neon PostgreSQL 17.10), after
applying `002`:

- `isolation.sql` and `documents.sql` both pass.
- All five roles report `rolbypassrls = false` and `rolinherit = false`; `contractor_app`,
  `control_app`, and `platform_runtime` report `rolcanlogin = false`.
- Through the **pooled** endpoint, `jbox_runtime` with no role assumed gets
  `permission denied for table organizations` — `NOINHERIT` is doing its job. The same pooled
  connection, opening a transaction with `SET LOCAL ROLE contractor_app` and
  `set_application_context()`, reads correctly as `current_user = contractor_app`. Transaction
  pooling and the transaction-scoped settings agree in practice, not just on paper.

**Open human gate:** production is not yet protected. The current Neon plan permits zero
protected branches and rejected the protection request. Upgrade the direct BagelTech Neon
organization before customer data enters production, then protect `production`. Do not treat
an unprotected production branch as launch-ready.

No J-Box Product or Control deployment existed when this database was provisioned, and
both apps were still package scaffolds without build scripts. Their runtime variables therefore
remain intentionally unwired rather than being attached to an empty or unrelated deployment.

## 1. Create the project

Neon console → **New Project**.

| Setting | Value |
|---|---|
| Name | `jbox` |
| Postgres version | 17 |
| Region | `aws-us-east-1` — match the application deployment region |
| Database name | `jbox` |

Neon creates an owner role (`jbox_owner` or similar). **That role is for migrations only.**
It owns the tables and has `CREATEROLE`, which migration 001 needs in order to create
`contractor_app`, `control_app`, and `platform_runtime`.

## 2. Apply migration 001 as the owner

Connect with the owner's **unpooled** connection string (migrations run DDL; use the direct
host, not `-pooler`).

```bash
psql "$DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -f packages/database/migrations/001_foundation.sql
```

This creates the three `NOLOGIN` application roles. They are `SET LOCAL ROLE` targets, hold no
password, and are therefore safe to define in version control.

## 3. Protect production, then create branches

Rename the default branch to `production` and protect it before creating children. Protection
prevents deletion and reset, and Neon automatically gives child branches distinct passwords for
copied roles. Protection requires a paid Neon plan.

Add two children of `production`:

```
production   (default, protected)
├── preview       ← Vercel preview deployments
└── development   ← local .env.local
```

Create branches **after** migration 001 so its schema and passwordless application roles are
copied into them. Create the login roles only after branching, once per branch, so the runtime
and control passwords are also distinct.

If protection is unavailable, stop before production launch. For initial development only,
create the branches and immediately rotate each child branch's copied owner password. The
provisioning helper enforces that rotation for non-production branches.

> Branch once, then never share endpoints. The prototype pointed local, preview, and production
> at one endpoint as owner. Local development wrote to production, and because the owner could
> bypass RLS, isolation could not be tested in any environment.

## 4. Create the restricted login roles

These carry secrets, so they are created here rather than in a migration. They must be created
through SQL. Neon grants roles created through its Console, CLI, or API membership in
`neon_superuser`; SQL-created roles receive only the privileges explicitly granted below.

For a fresh branch, use the fail-closed helper:

```bash
node scripts/provision-neon-branch.mjs \
  restless-meadow-35560667 production production keep-owner
node scripts/provision-neon-branch.mjs \
  restless-meadow-35560667 preview preview rotate-owner
node scripts/provision-neon-branch.mjs \
  restless-meadow-35560667 development development rotate-owner
```

The helper refuses existing login roles, refuses to overwrite local credential files, verifies
that no application role belongs to `neon_superuser`, and never emits passwords or connection
strings. The equivalent manual SQL is:

```sql
-- Application runtime. Not an owner. No BYPASSRLS. NOINHERIT so it holds no
-- privilege until it explicitly assumes a role for the transaction.
CREATE ROLE jbox_runtime LOGIN PASSWORD '<generated>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT contractor_app, platform_runtime TO jbox_runtime;
GRANT USAGE ON SCHEMA public TO jbox_runtime;

-- Control plane. Separate login; may assume only control_app.
CREATE ROLE jbox_control LOGIN PASSWORD '<generated>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT control_app TO jbox_control;
GRANT USAGE ON SCHEMA public TO jbox_control;
```

`NOINHERIT` is load-bearing. With it, `jbox_runtime` starts each transaction holding nothing
and must `SET LOCAL ROLE contractor_app` (tenant work) or `platform_runtime` (webhooks, cron,
health) to do anything. Without it, the login would silently carry the union of both roles'
privileges and the distinction the schema is built on would stop meaning anything.

Confirm the result:

```sql
SELECT rolname, rolcanlogin, rolbypassrls, rolinherit
FROM pg_roles
WHERE rolname IN ('jbox_runtime','jbox_control','contractor_app','control_app','platform_runtime')
ORDER BY rolname;
```

Every row must show `rolbypassrls = false`. The two login roles must show
`rolinherit = false`. Also verify that all five roles report false for:

```sql
pg_has_role(rolname, 'neon_superuser', 'member')
```

## 5. Verify isolation before wiring anything up

Against the **development** branch only — it provisions throwaway organizations and rolls back:

```bash
npm run db:verify
```

Runs every suite in `packages/database/checks/` (isolation, documents, pricing, field) through the
bundled node-pg runner, so no `psql` binary is required. Each suite's final line reads
`all checks passed`; a single failed assertion fails that suite. If it fails, stop — the message
names the specific guarantee that broke.

The provisioned development branch passed these suites on 2026-08-10. The test transactions
rolled back, leaving no throwaway organizations behind.

## 6. Wire the environment variables

Four values exist per environment. Three may be deployed; the owner value is operator-only. The
applications run as long-lived Node processes and maintain their own `pg` connection pool, so
they connect to the **direct (unpooled)** endpoint via `DATABASE_URL_UNPOOLED` — Neon's pooled
endpoint would be a second pool in front of ours, an extra hop solving a problem we no longer
have.

| Variable | Role | Endpoint | Where |
|---|---|---|---|
| `DATABASE_URL` | `jbox_runtime` | pooled | all environments (provisioned default) |
| `DATABASE_URL_UNPOOLED` | `jbox_runtime` | **direct** | all environments — the app's own pool reads this |
| `CONTROL_DATABASE_URL` | `jbox_control` | pooled | all environments (control plane) |
| `DATABASE_URL_OWNER` | owner | direct | **local only** — never set in a deployed environment |

The product app pools against `DATABASE_URL_UNPOOLED` (falling back to `DATABASE_URL`); the
control app connects with `CONTROL_DATABASE_URL`. Keep `DATABASE_URL` too — the provisioning
helper writes it and nothing assumes its absence.

```bash
# local development is already written by the provisioning helper
# and may be safely recovered/merged without printing values:
node scripts/provision-neon-branch.mjs \
  restless-meadow-35560667 development development recover-existing

# Fly.io, per app. The product app runs Storefront and Field; the control app
# is the operator plane. Never set DATABASE_URL_OWNER here.
fly secrets set --app jbox-product \
  DATABASE_URL='<prod pooled>' DATABASE_URL_UNPOOLED='<prod direct>'
fly secrets set --app jbox-control CONTROL_DATABASE_URL='<prod pooled>'
```

`DATABASE_URL_OWNER` existing only on your machine is what keeps a deployed application from
being able to run DDL or bypass the role model.

## Transaction-scoped session state

> Superseded in part: the apps no longer use Neon's pooled endpoint (see above). The rule below
> still holds, for a different and equally binding reason -- our own `pg` pool reuses a
> connection for the next request, so anything left at session scope leaks across requests.

Neon's pooled endpoint is PgBouncer in **transaction** mode, so nothing may rely on state
surviving between statements. The design already satisfies this and must continue to:

- `set_application_context()` uses `set_config(..., true)` — the `true` makes each setting
  **transaction-local**.
- `SET LOCAL ROLE` is likewise transaction-scoped.

A plain `SET ROLE` or a session-level `set_config(..., false)` would appear to work in
development against the direct host and then leak between unrelated requests through the
pooler. Keep both scoped.

## What not to do

- Do not point two environments at one branch.
- Do not put `DATABASE_URL_OWNER` in any deployed environment (Fly secrets, Vercel, or otherwise).
- Do not create runtime or control logins through the Neon Console, CLI, or API; those interfaces
  grant `neon_superuser` membership. Create them through SQL and verify membership afterward.
- Do not grant `BYPASSRLS` to any role. `checks/isolation.sql` fails the build if you do —
  `BYPASSRLS` silently defeats `FORCE ROW LEVEL SECURITY`, so the protection would look
  present while being absent.
- Do not run `isolation.sql` against production. It writes.
