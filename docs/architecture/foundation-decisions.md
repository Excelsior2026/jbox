# Foundation Decisions

The four questions the porting ledger reserved, settled. Each was a defect in the
predecessor; each is cheap to get right now and expensive later.

---

## 1. Document identity — surrogate key, per-tenant number, frozen display id

**Decision.** Every commercial document carries three identifiers with three different jobs:

| Column | Type | Job |
|---|---|---|
| `id` | `uuid` PK | Internal. The only thing foreign keys reference. |
| `document_number` | `bigint` | Per-tenant sequence. `UNIQUE (organization_id, document_number)`. |
| `display_id` | `text` | Human-facing, e.g. `PE-EST-0042`. Rendered once and **frozen**. |

**What went wrong before.** The predecessor used a single global text primary key,
`estimates.id text PRIMARY KEY CHECK (id ~ '^PE-EST-[0-9]{4,}$')`, allocated from a
per-organization counter that starts every tenant at 42. Three facts that cannot all hold at
once: the `CHECK` demands the `PE-` prefix, the tenant configuration offers a per-tenant
prefix, and the primary key is global. A second tenant with prefix `AC-EST` fails the `CHECK`;
a second tenant reusing `PE-EST` collides on the primary key. Tenant #2 could not create a
customer.

**Why three columns rather than a composite key.** A composite `(organization_id, id)` primary
key spreads the tenant column into every foreign key in the schema — `estimate_line_items`,
`job_events`, `invoice_events`, `payments` — and every join. The surrogate uuid keeps
referential integrity boring while `UNIQUE (organization_id, document_number)` carries the
tenant-scoped uniqueness.

**Why `display_id` is stored rather than computed.** Computing it at render time from
`config.documents.estimatePrefix` would mean a tenant editing their prefix retroactively
changes the identifier printed on estimates a customer has already signed. A signed estimate is
a contract. Its identifier is part of the frozen document, alongside the content hash. Storing
it also means the prefix is free to change for *future* documents without a data migration —
the property the predecessor's `CHECK` constraint made impossible.

**Consequence.** Prefixes need no cross-tenant uniqueness enforcement and no reserved-resource
machinery. Two tenants may both use `PE-` and nothing collides, because `display_id` is unique
only within an organization and nothing joins on it.

---

## 2. The runtime login is never the table owner

**Decision.** Three roles, none of which owns a table, plus an owner used only by migrations.

| Role | Login | `BYPASSRLS` | Assumed by |
|---|---|---|---|
| `contractor_app` | no | no | tenant-scoped work — `db()` |
| `platform_runtime` | no | **yes** | cross-tenant paths with no tenant — `platformDb()` |
| `control_app` | no | no | operator plane — `controlDb()` |
| *(owner)* | yes | — | `npm run db:migrate` only |

The application connects as a restricted login holding almost no privilege of its own and
assumes exactly one of these per transaction via `SET LOCAL ROLE`.

**What went wrong before.** The predecessor's runtime connected as `neondb_owner`, which owned
all 56 tables *and* held `rolbypassrls = true`. Its scoped client did `SET LOCAL ROLE
contractor_app` and was genuinely isolated — measured: 10 populated tenant tables, rows visible
as owner, zero as `contractor_app` without context. But its unscoped client returned the raw
connection, so webhook, cron, health, and hostname-resolution paths ran with total cross-tenant
access. Isolation was decided by a deployment credential rather than by anything visible in
code.

**Why `platform_runtime` holds `BYPASSRLS` deliberately.** Stripe and Clerk webhooks and the
outbox drain arrive with no Host header, so there is no tenant to scope to. Those paths need
cross-tenant reach. The question is only whether that reach is *granted explicitly* or
*inherited silently*. Naming it in the role makes it greppable, and it means the
connecting credential can be demoted without breaking webhooks. Explicit cross-tenant policies
per table remain the upgrade path if a compliance requirement demands one.

---

## 3. `FORCE ROW LEVEL SECURITY` on every tenant table, from the start

**Decision.** Every table with RLS gets `ENABLE` **and** `FORCE`, in the same migration that
creates it. `db:rls:check` fails the build if a table has one without the other.

**What went wrong before.** Fifteen `ENABLE ROW LEVEL SECURITY` statements, zero `FORCE`.
`ENABLE` does not constrain the table owner, so the protection was absent for precisely the role
migrations run as. It went unnoticed for 44 migrations because nothing asserted it.

**The subtlety worth writing down.** `FORCE` is defeated by `BYPASSRLS`. All three layers must
line up — policies enabled, forced against the owner, and a connecting role without the bypass —
and they are routinely conflated. Applying `FORCE` alone to the predecessor's database would
have changed nothing while creating a strong impression that isolation had been fixed.

---

## 4. One database branch per environment

**Decision.** Local, preview, and production each get their own Neon branch, and no environment
connects as the owner. Preview branches are ephemeral per deployment.

**What went wrong before.** `.env.local`, `.vercel/.env.preview.local`, and Vercel production all
pointed at the identical endpoint (`ep-floral-dream-avstsfkj`) as `neondb_owner`. Local
development wrote to production. A destructive local experiment was a customer outage, and
tenant isolation could not be meaningfully tested in any environment, because every environment
connected as the one role exempt from it.

**Operational consequence.** `db:rls:check` becomes runnable in CI against a disposable branch,
which is what keeps decisions 2 and 3 from decaying.

---

## Not settled here

**Costing method for inventory valuation** (FIFO vs. weighted average) is deferred. The
inventory module's first version reports quantity, not value, so the decision is not yet
load-bearing.
