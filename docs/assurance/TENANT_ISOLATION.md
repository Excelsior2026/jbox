# TENANT_ISOLATION

Scope: adversarial tenant-isolation testing of the database layer on the J-Box monorepo.
Produced: 2026-08-13 by the architecture-assurance pass. All assertions below were observed against a live
development database, not assumed. Where a property could not be demonstrated inside the test harness it is
marked **UNVERIFIED** with the reason.

## 1. What is tested

`packages/database/checks/isolation-adversarial.sql` is an extension of the existing `isolation.sql` suite. It
provisions two throwaway organizations (tenant-alpha, tenant-beta) with representative rows across every
tenant-owned table, then attempts to break the isolation boundary. Every assertion raises on failure, so a clean
exit is the pass condition. The suite runs inside a single transaction and **ROLLBACKs** at the end — nothing it
provisions persists. Run it against a disposable branch, never production:

```
node --env-file-if-exists=.env.local packages/database/run-sql-check.mjs isolation-adversarial.sql
```

The runner executes against `DATABASE_URL_OWNER` (migration owner, which holds `contractor_app`, `control_app`,
`platform_runtime`), matching the `isolation.sql` convention.

## 2. Sections and what each proves

| # | Section | Guarantee tested | Result |
|---|---|---|---|
| 1 | Tenant sees only its own organization | 13 tenant-owned tables return zero rows for the foreign `organization_id`; a foreign row addressed by exact primary key is invisible | PASS |
| 2 | Guessed foreign ids | UPDATE / DELETE of a foreign row filters to zero rows; INSERT pointing at a foreign customer fails (composite FK + RLS WITH CHECK); INSERT naming a foreign `organization_id` fails | PASS |
| 3 | Missing / null / malformed context | Empty or NULL context fails closed (`app_require_organization_id` raises `insufficient_privilege`); a malformed (non-uuid) context raises `invalid_text_representation` and is refused | PASS |
| 4 | Stale pooled-connection state | Context is transaction-scoped (`set_config(..., is_local := true)`); an unset GUC reads NULL, and context set inside a subtransaction is reverted when that subtransaction aborts | PASS |
| 5 | Nested context switching | alpha then beta on the same connection: each sees only its own rows | PASS |
| 6 | Cross-org service request claim | A service-request claim scoped to alpha cannot claim beta's row | PASS |
| 7 | Outbox lease (defect recording) | Crashed `claimed` rows with an expired lease are **not** re-claimable, and still-pending rows remain claimable — documents the known lease defect | PASS (defect NOTICE emitted, see §4) |
| 8 | Control-plane path | `control_app` cannot write tenant content (no policy; SELECT-only grant) | PASS |
| 9 | Worker path | `platform_runtime` cannot read or write tenant content outside the SECURITY DEFINER windows | PASS |
| 10 | Identity rows | `platform_users` / `organization_memberships` are RLS-guarded for `contractor_app` and writeable only via the control path | PASS |
| 11 | Auth windows | `staff_login_lookup` (SECURITY DEFINER) resolves a user only in the tenant they belong to; cross-tenant lookup returns zero rows | PASS |
| 12 | Owner path | The migration owner (BYPASSRLS) observes both tenants — the operator path is deliberately elevated and must never be deployed | PASS |

## 3. Observed behavior notes

- **Malformed context fails closed, but with a hard error, not a NULL.** A non-uuid `app.organization_id`
  makes `app_current_organization_id()` raise `invalid_text_representation` (22P02) rather than resolve to NULL.
  Requests fail loudly — no silent tenant boundary collapse — but the error type is not the `insufficient_privilege`
  used for a missing context. This is a robustness note, not a defect: both paths refuse the write.
- **Ownership insert paths are control-plane only.** `organization_memberships` grants `contractor_app` SELECT only;
  the membership INSERT in this suite must run under `control_app` (as production provisioning does). Mirror the
  control path when provisioning a tenant.
- **The dev database carries ambient rows.** The suite scopes owner-path assertions to the two synthetic
  organizations rather than asserting global counts, so pre-existing development data (e.g. the seeded
  `PE-EST-0001` estimate) does not create false failures.

## 4. Lease defect (recorded by the suite)

The suite's section 7 drives a message to `status = 'claimed'` with `claimed_until` one hour in the past, then
claims a batch. The run emits:

```
NOTICE: LEASE DEFECT CONFIRMED: 1 crashed claimed message(s) with an expired lease are not re-claimable
        (claim predicate selects status IN ('pending','failed') only; claimed_until is never consulted).
```

`claim_ready_outbox_messages()` (`packages/database/migrations/005_field_identity_and_customer_access.sql:464-484`)
sets `claimed_until = now() + interval '5 minutes'` but its WHERE clause never reads `claimed_until`. A worker that
crashes after claiming leaves the row in `claimed` forever; the daily cron (`apps/product/src/lib/outbox-dispatch.ts`)
only ever re-selects `pending`/`failed` rows. The suite asserts this is the current behavior (the crashed row is NOT
rescued) and that the drain itself still works (the still-pending row IS claimed), so the assertion is a
regression-catch on the defect, not a papering-over.

## 5. Harness limitations (UNVERIFIED)

- **COMMIT-time clearing of the tenant GUC.** The suite runs in one transaction, so it cannot demonstrate that a
  local context disappears at a real `COMMIT`/`ROLLBACK`. It proves the two mechanisms that provide this
  (transaction-local `set_config(..., true)` in `set_application_context()`, and reversion on subtransaction abort)
  and otherwise relies on documented PostgreSQL semantics. Direct COMMIT-boundary proof requires a separate
  connection and is **UNVERIFIED** in this harness.
- **Pooled-connection reuse across real requests.** Proving that a pooled connection that served alpha never serves
  beta without a fresh `set_application_context()` would require multi-connection coordination; the suite proves the
  database-level failure modes instead. Application-level pool hygiene is covered by the auth session tests
  (`apps/product/src/lib/auth-adversarial.test.ts`).

## 6. Conclusions

- The RLS boundary (organization-id context + composite-tenant FKs + per-role policies) held against every
  adversarial write/read/update/delete in the suite. No tenant-boundary bypass was found.
- The outbox lease defect is confirmed behavior and is tracked as HIGH in the remediation plan
  (see `REMEDIATION_PLAN.md`); it is an operational-recovery gap, not an isolation gap.
- The isolation guarantee is tied to the operator never deploying `jbox_owner`: the owner path is deliberately
  exempt from RLS (section 12). This is an architecture property, not an assurance of it — treat owner credentials
  as untrusted-in-deploy (see `CURRENT_STATE.md` §2).
