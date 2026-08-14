# Cross-layer assurance matrix

Assurance snapshot: 2026-08-14

Reviewed commit: `ca9472238c73d5d92a8ab4cc87e84ff31e8ca0af`

Status meanings: **PASS** is limited to the tested mechanism; **PARTIAL** means the mechanism exists but the end-to-end property is incomplete; **FAIL** means observed behavior contradicts the intended property; **UNVERIFIED** means the required environment/evidence does not exist.

| Intended property | Mechanism | Environmental assumptions | Observed behavior | User-visible failure | Status |
|---|---|---|---|---|---|
| Field requires staff identity | JWT, JTI ledger, live membership | Production cannot use demo principal | Missing/invalid JWT falls through to synthetic owner | Anonymous Field data/mutations | **FAIL** |
| Password sessions expire/revoke | JWT expiry, `field_sessions`, logout | Identity transitions bulk-revoke | Password/role/status changes do not revoke; old JTI survives | Old token works after reactivation | **FAIL** |
| Disabled user fails immediately | Live user/membership/org lookup | Reactivation starts a new auth epoch | Fails while disabled, but surviving token can revive | Unexpected access after re-enable | **PARTIAL** |
| MFA-required means MFA | `mfa_required` in DB lookup | Challenge + satisfied-session evidence | Flag is ignored | Password-only login | **FAIL** |
| Native identity can join multiple tenants | Tenant membership table and org login choice | Membership external ID is unique per membership | `'native-' + user_id` collides globally | Second membership fails/500 | **FAIL** |
| Staff and customer credentials are separate | Staff JWT cookie; customer HMAC link | URL remains secret | Separate mechanisms; customer token is purpose/tenant/expiry bound | Stolen URL is bearer access | **PASS with assumptions** |
| Host resolves only active verified tenant | Host classifier + definer resolver | Trusted proxy Host/DNS mapping | Unknown/unverified hosts fail closed | 404/unavailable | **PASS** |
| Tenant rows are database-isolated | Forced RLS, org GUC, composite FKs | Non-owner/NOBYPASS login; scoped client only | Two-tenant CRUD adversarial checks pass | No direct crossover observed | **PASS for tables** |
| Platform windows are narrow | Pinned `SECURITY DEFINER` functions | `PUBLIC EXECUTE` revoked | Tenant role can execute auth/provision/outbox windows | Cross-tenant escalation after SQL foothold | **FAIL** |
| Branch per environment | Separate Neon branches/config files | Correct wiring and current migrations | Local control points prod; Preview has no DB; preview branch stops at 002 | Local prod mutation; unusable preview | **FAIL** |
| Deployment is schema compatible | Migrations, health, CI isolation | Migrate/verify before promote | Prod is currently 008, but CI runs zero jobs and health checks 004/006 | READY deployment can 500 | **FAIL** |
| Config is append-only/recoverable as-of time | Version table, one-in-force index | Atomic approve/supersede; immutable interval | Document immutable; supersede time mutable; no procedure/effective time | Wrong/no config selected | **PARTIAL** |
| Signed estimate reproduces accepted artifact | Terminal row, content hash, customer snapshot | Hash includes all rendered inputs/artifact | Current config rendered later, outside hash | Historical signed page changes | **FAIL** |
| Pricing cannot mutate under document | Item versions, stored line values/totals | Published path used | Reviewed estimate path uses snapshots/version refs | None observed | **PASS in reviewed path** |
| Customer link is scoped/revocable | HMAC, hash-only row, status/expiry/purpose | Token URL confidentiality | Verification fails closed; sign consumed after decision | URL leak grants access until revoke/expiry | **PASS with assumptions** |
| Delivery creation is atomic | Grants + outbox table | All writes share transaction | Grants and enqueue use separate commits; cleanup best effort | Orphan link/incomplete send | **FAIL** |
| Worker recovers after crash | Claim lease, attempts, provider idempotency | Expired claims re-enter; scheduler meets retry SLO | Expired claims stranded; daily batch; retryable flag ignored | Email stuck or days late | **FAIL** |
| Missing provider fails closed | Provider gate before enqueue | Provider enabled only after approval | No production Resend key; request refuses before queue | Delivery unavailable, no false queued state | **PASS, disabled** |
| Storefront photos are durable | Local storage keys + request rows | Persistent Fly volume; body limits align | Production is Vercel read-only/ephemeral; 8 MiB exceeds 4.5 MB | Upload fails or file disappears | **FAIL** |
| Public onboarding cannot abuse control | Honeypot, IP bucket, server-held token | Shared/durable limiter; verified identity | Process-local limiter; anonymous tenant/config writes | Spam and namespace squatting | **FAIL** |
| Health means core release is usable | DB/migration health | Latest schema/dependencies checked | 200 during anonymous auth bypass and unavailable delivery/storage | False-green operations | **FAIL** |
| AI drafting fails soft | AI call + deterministic fallback | Correct environment key if AI desired | Vercel has `NVIDIA_KEY`; code reads `NVIDIA_API_KEY`; fallback always used | Configured-looking AI never runs | **PARTIAL** |
| Control changes identify an operator | Timing-safe shared bearer | Per-operator identity/audit | All callers share one standing token; no durable audit found | Cannot attribute sensitive change | **FAIL** |
| Errors are diagnosable per tenant | Request/tenant IDs, structured telemetry | Log drain/alerts/SLOs | Mostly generic `console.error`, some swallowed; no tenant attribution | Silent/stale work and slow incident diagnosis | **FAIL** |

## Cross-layer conclusions

1. The strongest layer is direct PostgreSQL row isolation. Its result must not be generalized to identity binding or privileged function ACLs.
2. Authentication fails open only because deployment configuration activates a code path expressly able to do so; environment state is part of the security model.
3. Native auth is a partial Clerk replacement: password verification and sessions exist, but lifecycle, MFA, multi-org membership, recovery, and audit semantics do not.
4. The transactional outbox is a table and worker pattern, not currently an end-to-end transactional delivery guarantee.
5. “Signed” currently means a terminal estimate row with a partial content hash, not a reproducible immutable customer artifact.
6. Vercel is the verified runtime; long-lived Fly process/volume assumptions must be removed from production claims and code.
7. A passing local test suite is not a release gate while GitHub creates zero jobs and Preview cannot run the product contract.
