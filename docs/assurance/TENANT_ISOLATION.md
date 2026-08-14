# Tenant isolation assurance

Assurance snapshot: 2026-08-14

Scope: PostgreSQL row isolation, runtime roles, tenant binding, and privileged cross-tenant windows.

## Verdict

**Direct table isolation is strong; the complete isolation boundary is not assured.**

The database uses the right core structure: non-owner runtime logins, `SET LOCAL ROLE`, transaction-local tenant context, forced RLS, tenant-scoped uniqueness, and composite foreign keys. The two-tenant adversarial suites held against foreign-ID reads/writes, null/malformed context, pooled-context switching, and unauthorized direct control/worker table access.

However, every application-created function retained PostgreSQL's default `PUBLIC EXECUTE`. As a result, `contractor_app` can execute privileged `SECURITY DEFINER` auth, provisioning, hostname, and outbox functions. RLS is not bypassed through direct table policies, but the definer-function door around it is broader than intended.

## Intended boundary

1. Host resolution uses one narrow platform function to map an active verified hostname to an organization.
2. Field authentication binds the principal to an active organization membership.
3. Tenant work runs as `contractor_app` inside a transaction with `app.organization_id` set locally.
4. `platform_runtime` and `control_app` reach cross-tenant state only through explicitly granted, reviewed functions/tables.
5. No deployed login is a table owner or has `BYPASSRLS`.

The implementation satisfies items 3 and 5 in current production. Item 2 fails because production demo mode supplies an owner principal without authentication. Item 4 fails because function ACLs are public.

## Adversarial SQL results

`npm run db:verify` ran all six suites on the development branch. The isolation suite creates two throwaway tenants and rolls back. Results:

| Property | Result | Scope/qualification |
|---|---|---|
| Foreign rows hidden from `contractor_app` | PASS | Representative tenant tables and exact foreign primary keys |
| Foreign update/delete | PASS | Zero rows affected |
| Foreign FK references | PASS | Composite FK/RLS check rejects |
| Missing/null context | PASS | Writes fail closed |
| Malformed UUID context | PASS | Hard PostgreSQL error; no fallback tenant |
| Context switching on one connection | PASS | Alpha and beta each see only their rows |
| Transaction-local context | PASS | Subtransaction reset proven; real pool COMMIT reuse remains an app-level assumption |
| `control_app` direct tenant-content write | PASS (denied) | Provisioning must switch to `contractor_app` |
| `platform_runtime` direct tenant-content read/write | PASS (denied) | Definer functions not covered by this assertion |
| Runtime login attributes | PASS | Production `jbox_runtime` is non-owner, `NOBYPASSRLS`, `NOINHERIT` |
| Owner path | EXPECTED ELEVATION | Owner sees both tenants and must never be deployed |
| Outbox expired lease | **DEFECT CONFIRMED** | Suite emits notice but still exits successfully |

## Privileged-function ACL defect

Relevant functions:

- hostname: `001_foundation.sql:196-215`;
- Clerk/native identity and membership: `005_field_identity_and_customer_access.sql:254-439`, `007_native_field_auth.sql:93-270`;
- outbox: `005_field_identity_and_customer_access.sql:446-515`.

The migrations grant named roles at `001...sql:378-391`, `005...sql:641-651`, and `007...sql:313-319`, but they never execute `REVOKE ... FROM PUBLIC`. PostgreSQL functions are executable by `PUBLIC` by default.

Read-only `has_function_privilege` checks on both development and production returned true for `contractor_app` on:

- `resolve_verified_organization(text)`;
- `staff_login_lookup(text, uuid)`;
- `staff_session_membership(uuid, uuid)`;
- `staff_memberships_for_email(text)`;
- `provision_staff_member(text, text, text, uuid, text)`;
- `claim_ready_outbox_messages(integer)`;
- `finish_outbox_message(uuid, boolean, text)`.

This means any SQL foothold in a tenant-role transaction can invoke cross-tenant windows. The inspected application queries are parameterized, and no direct injection was found, so the defect is a privilege-escalation boundary rather than a proven public exploit.

## Application-to-tenant binding defect

`field-api-auth.ts:79-101` binds missing/invalid authentication to the environment-selected organization with owner capabilities when demo mode is enabled. This is live in Production. RLS then correctly isolates the request to that organization, but the identity-to-tenant binding is unauthenticated. Database isolation cannot compensate for a principal factory that deliberately chooses a real tenant for an anonymous caller.

## Environmental assumptions

The isolation claim remains conditional on all of the following:

- Vercel forwards a trustworthy original Host and domains are mapped correctly.
- The product uses `jbox_runtime`, not an owner credential.
- Every tenant query goes through `db()` and starts a fresh transaction/role/context.
- No connection/session state survives because `SET LOCAL ROLE` and `set_config(..., true)` remain transaction-local.
- Definer functions have least-privilege ACLs.
- Preview/development never point operational tools at production.
- Production demo mode is impossible.

The current system violates the last three assumptions in at least one environment.

## Required remediation and proof

1. Forward migration: revoke all application functions from `PUBLIC`; explicitly grant exact roles.
2. Set secure default privileges so future functions do not reopen the boundary.
3. Add ACL assertions for every function and role, including negative tests under the actual login after `SET LOCAL ROLE`.
4. Remove production demo mode and add a code-level production invariant.
5. Correct `jbox_control` provisioning to include `contractor_app`; test a fresh branch end to end.
6. Correct local control's production connection and add immutable environment identity guards.
7. Add a multi-connection test proving tenant context is absent after real COMMIT/ROLLBACK and pool reuse.
8. Keep owner credentials out of all deployed environments and add a deployment check that queries `current_user`, ownership, `rolbypassrls`, and memberships.

Tenant isolation can be marked assured only when the table-policy tests and privileged-function ACL tests both pass against the exact role/deployment contract.
