# Database Setup

How to stand up J-Box's Neon project, branches, and roles.

Everything here is done **once per environment** and is deliberately not automated: it
creates credentials, and a credential in a migration would land in git and fail
`npm run secrets:check`.

## Use a new Neon project, not the predecessor's

The prototype's project is `proud-forest-86717198`, and its single endpoint
(`ep-floral-dream-avstsfkj`) is currently serving Paris Electric in production while also
being what `.env.local` and Vercel preview point at. J-Box gets its own project so that
neither system can affect the other, and so the prototype keeps running untouched during
the cutover.

## 1. Create the project

Neon console → **New Project**.

| Setting | Value |
|---|---|
| Name | `jbox` |
| Postgres version | 17 |
| Region | `aws-us-east-1` — match the Vercel deployment region (`iad1`) |
| Database name | `jbox` |

Neon creates an owner role (`jbox_owner` or similar). **That role is for migrations only.**
It owns the tables and has `CREATEROLE`, which migration 001 needs in order to create
`contractor_app`, `control_app`, and `platform_runtime`.

## 2. Create branches

Neon's default branch (`main` or `production`) is production. Add two:

```
production   (default branch)
├── preview       ← Vercel preview deployments
└── development   ← local .env.local
```

Console → **Branches** → **New Branch**, parent `production`, for each.

Create branches **after** step 3 so roles and schema are copied into them, rather than
having to repeat every step per branch.

> Branch first, then never share. The prototype pointed local, preview, and production at one
> endpoint as owner. Local development wrote to production, and because the owner holds
> `BYPASSRLS`, row-level security was inert everywhere — so isolation could not be tested in
> any environment.

## 3. Apply migration 001 as the owner

Connect with the owner's **unpooled** connection string (migrations run DDL; use the direct
host, not `-pooler`).

```bash
psql "$DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -f packages/database/migrations/001_foundation.sql
```

This creates the three `NOLOGIN` application roles. They are `SET LOCAL ROLE` targets, hold no
password, and are therefore safe to define in version control.

## 4. Create the restricted login roles

These carry secrets, so they are created here rather than in a migration. Run as the owner,
substituting generated passwords:

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
`rolinherit = false`.

## 5. Verify isolation before wiring anything up

Against the **development** branch only — it provisions throwaway organizations and rolls back:

```bash
psql "$DEV_DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -f packages/database/checks/isolation.sql
```

Expected final line: `isolation.sql: all checks passed`. If it fails, stop — the message names
the specific guarantee that broke.

## 6. Wire the environment variables

Six values per environment. Use the **pooled** host for the runtime and the **unpooled** host
for migrations.

| Variable | Role | Where |
|---|---|---|
| `DATABASE_URL` | `jbox_runtime`, pooled | all environments |
| `DATABASE_URL_UNPOOLED` | `jbox_runtime`, direct | all environments |
| `CONTROL_DATABASE_URL` | `jbox_control`, pooled | all environments |
| `DATABASE_URL_OWNER` | owner, direct | **local only** — never set in a deployed environment |

```bash
# local
cp .env.example .env.local      # then fill from the development branch

# Vercel
vercel env add DATABASE_URL production      # production branch
vercel env add DATABASE_URL preview         # preview branch
```

`DATABASE_URL_OWNER` existing only on your machine is what keeps a deployed application from
being able to run DDL or bypass the role model.

## Pooler compatibility

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
- Do not put `DATABASE_URL_OWNER` in Vercel.
- Do not grant `BYPASSRLS` to any role. `checks/isolation.sql` fails the build if you do —
  `BYPASSRLS` silently defeats `FORCE ROW LEVEL SECURITY`, so the protection would look
  present while being absent.
- Do not run `isolation.sql` against production. It writes.
