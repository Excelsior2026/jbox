# Remediation plan

Assurance snapshot: 2026-08-14

Goal: close the observed production and cross-layer assurance defects without broad redesign.

## P0 — Immediate containment

### P0.1 Remove the production demo principal

- Remove `FIELD_DEMO_MODE` and `DEVELOPMENT_FIELD_ORGANIZATION_ID` from Product Production.
- Redeploy the exact intended commit.
- Add a code-level production invariant so the deployment cannot start/open Field when demo mode is enabled.
- Verify anonymous requests to every Field route return 401. Include non-browser requests with a forged Origin header.
- Preserve/review Vercel and database evidence for the exposure window and follow the incident process.

**Exit evidence:** deployed commit ID; redacted environment-name inventory; anonymous GET and mutation matrix; incident decision.

### P0.2 Keep outbound email disabled

Do not add `RESEND_API_KEY` until sender/domain/recipient policy is approved and delivery/outbox remediation is complete. Current fail-closed behavior is preferable to enabling a worker with known data-loss/stall behavior.

## P1 — Re-establish enforceable trust boundaries

### P1.1 Restrict database functions

- Add one forward migration: `REVOKE ALL ... FROM PUBLIC` for every application function; explicit grants only.
- Configure secure default function privileges for future migrations.
- Add positive and negative `has_function_privilege` checks for every role/function.
- Run on disposable development/preview, then migrate production through the normal controlled path.

**Exit evidence:** ACL matrix under actual logins; six SQL suites plus new ACL suite; production read-only privilege query.

### P1.2 Repair CI

- Remove direct secret use from job-level `if`.
- Gate the DB step with a safe env/repository-variable pattern.
- Commit the narrow synthetic localhost fixture allowlist.
- Add Actions workflow linting.
- Because private-repo branch protection is unavailable on the current plan, document an explicit promotion approval until enforcement is available.

**Exit evidence:** a passing run with nonzero jobs and a deliberate failing branch that is refused promotion.

### P1.3 Restore environment separation

- Point `apps/control/.env.local` at development.
- Add explicit immutable environment/Neon branch identifiers and refuse production from development/test.
- Add equivalent hard guards to owner migration/verify/seed tools.
- Rotate any local credentials whose placement no longer matches policy.

**Exit evidence:** redacted branch identity from product/control/tools; attempted cross-environment run fails before connecting/mutating.

## P2 — Complete native-auth semantics

### P2.1 Identity versus membership

- Forward-migrate `clerk_membership_id` to a nullable/provider-qualified external ID.
- Give every native membership its own ID independent of `platform_user_id`.
- Split global credential/profile changes from tenant membership create/reactivate/role changes.
- Ensure a tenant operator cannot globally reactivate or reset another tenant's identity without explicit platform authorization.

### P2.2 Session lifecycle

- Create atomic procedures for password reset/change, user suspend/reactivate/delete, membership revoke/reactivate, and role change.
- Revoke all sessions and increment a monotonic auth/session version in the same transaction.
- Ensure reactivation cannot revive an old token.
- Decide whether role changes force re-login; match code, comments, and tests.

### P2.3 Account controls

- Implement or remove `mfa_required`; do not leave it decorative.
- Authenticate before returning multi-organization choices.
- Define reset/recovery, password policy, hash version/rehash, maximum input size, and deployment-wide rate limits.
- Replace standing staff-provision secret flows with identified/audited operator or scoped service actions.

**Exit evidence:** real-DB multi-org and lifecycle suite, including wrong-password enumeration, disabled/reactivated JTI, MFA-required, reset, role change, and concurrent transition cases.

## P3 — Make customer documents and delivery durable

### P3.1 Signed estimate evidence

- Add immutable governing config and canonical-document references.
- Persist canonical signed JSON, hash version, consent text version, signer metadata, and rendered artifact.
- Render historical signed pages only from that evidence.
- Verify stored hashes on read/export.

### P3.2 Atomic delivery

- Add a delivery record.
- In one tenant transaction: bind estimate version, revoke previous grants, issue view/sign grants, and enqueue outbox payload.
- Use delivery ID as the provider idempotency key and audit correlation ID.
- Remove best-effort compensating cleanup as the correctness mechanism.

### P3.3 Recoverable worker

- Reclaim expired `claimed` rows.
- Return attempts and claim token/version; require them in `finish`.
- Honor retryable versus terminal errors.
- Drain in bounded loops with per-tenant fairness and an explicit latency/backlog SLO.
- Alert on oldest pending, expired lease, dead rows, provider auth, and missed/failed cron.
- Account for Vercel cron duplicate delivery and lack of retries.

**Exit evidence:** fault-injection matrix at each DB/provider boundary; duplicate cron test; backlog/fairness test; real approved provider delivery to approved recipients.

## P4 — Align deployment and storage

### P4.1 Durable photo storage

- Select private object storage.
- Use direct/presigned uploads within platform limits.
- Validate magic bytes/content type, size, count, and ownership.
- Finalize DB metadata transactionally; expire/delete orphan uploads.
- Add deployed upload/read/delete tests.

### P4.2 Preview and schema promotion

- Migrate Preview from 002 to current and supply non-production DB/auth/storage contract.
- Fix `provision-neon-branch.mjs` so `jbox_control` can assume both required roles.
- Add a pre-promotion check for latest migration, role memberships, no owner/BYPASS runtime, required secrets, and prohibited demo flags.
- Update product/control health to the current schema and separate liveness/readiness.

### P4.3 Runtime contract

- Pin one supported Node version in local tooling, CI, and Vercel.
- Resolve the `pg` SSL warning with explicit verification semantics.
- Prove the database connection budget under Vercel autoscaling; use the pooled/serverless endpoint or an equivalent bounded design.
- Remove/quarantine stale Fly manifests/comments and the failed duplicate control Vercel project.

**Exit evidence:** preview browser/API flow; fresh-branch control provisioning; schema-role gate; connection/load test; deployed photo flow.

## P5 — Production operations before general availability

- Convert public onboarding to verified intake or a narrowly scoped, quota-controlled provisioning operation.
- Add per-operator identity, least privilege, approvals, and durable audit to Control.
- Add structured redacted logs with request/tenant/delivery IDs, error aggregation, metrics/traces, log retention, and token-path redaction.
- Build per-tenant health for domain/config/auth/outbox/storage and last successful critical operation.
- Document and test backup, single-tenant restore, secret rotation, customer-link revocation, and incident communications.

## Release gate

Do not treat JBox as production-ready until:

1. P0 and P1 are complete and independently re-verified.
2. Every Critical/High item in the production-readiness report has a regression test and deployed evidence.
3. GitHub executes the quality/isolation gate and Preview runs the same schema/role contract.
4. Anonymous denial, native-auth lifecycle, function ACLs, signed artifact history, durable photo flow, and crash-safe email pass end to end.
5. MFA/reset/audit/observability decisions are implemented before unrelated external tenant staff/customer data enters the platform.

No remediation code or live configuration was changed during this review. The findings were documented first, as required; fixes should be reviewed and shipped in the sequence above.
