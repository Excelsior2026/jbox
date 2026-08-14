# Signed-estimate invariants

Assurance snapshot: 2026-08-14

Scope: estimate issue/sign/decline, customer links, immutable history, configuration, and rendering.

## Verdict

**The database prevents ordinary edits to a terminal estimate, but JBox cannot reproduce or verify the exact branded document a customer accepted.** The current property is “terminal estimate facts with a partial content hash,” not “immutable signed artifact.”

## Intended invariants

1. A signed estimate's identity, customer, scope, exclusions, pricing, totals, business identity, governing disclosures/footer, and visual document inputs are frozen.
2. The signer name, affirmative consent, signature time, source IP/user agent, and hash algorithm/version are durably associated with the same record.
3. The system can reconstruct the exact customer-visible artifact and verify its hash without consulting mutable current configuration.
4. A customer sign link is tenant-, document-, version-, purpose-, and expiry-bound and cannot decide twice.
5. Signing, audit event, and grant consumption are one atomic transition.

## What is currently frozen

`apps/product/src/lib/estimates.ts:388-449` computes a hash over:

- frozen `displayId` and document template version;
- customer snapshot;
- scope and exclusions;
- discount, surcharge, tax, and deposit values;
- money version;
- line-item snapshots;
- computed totals.

The same statement moves the estimate from `draft` to `signed`, records signer name/time, snapshots customer fields, stores the hash, and inserts a signed event. Database terminal triggers prevent ordinary line/header mutation afterward. These are valuable controls.

## Missing from the frozen contract

The hash/persisted canonical record does not include:

- configuration version ID;
- business name/contact/address/branding;
- document footer, legal/regulatory text, or approval evidence;
- renderer/template implementation version beyond the stored document template string;
- a rendered PDF/HTML artifact or canonical serialized payload;
- signer name, signature timestamp, affirmative-consent text/version;
- customer-link/delivery ID and delivery timestamp.

Only the digest is stored; the canonical object used to compute it is not. There is no read-time hash verification.

## Current cross-layer failure

`apps/product/src/app/estimates/[token]/page.tsx:49-61` loads the estimate and then calls `loadInForceConfig()`. It renders the **current** business identity/contact, not the configuration in force at issue/sign time. A later config change therefore changes the historical signed page outside the hash.

`estimate-delivery.ts:106-126` creates grants with `resourceVersionId: null`. Although the HMAC token format supports a resource version, the estimate link is not version-bound.

`customer-estimate-decision.ts:96-115` commits the estimate decision and then consumes the grant in a separate transaction. A crash can leave an active sign grant pointing at an already-terminal estimate. The status guard prevents a second decision, but state/audit are inconsistent.

## Invariant table

| Invariant | Mechanism | Observed state |
|---|---|---|
| Frozen internal ID/display ID | Stored columns; terminal row | PASS |
| Frozen customer facts | Migration 006 snapshot + sign update | PASS |
| Frozen line descriptions/prices/totals | Line snapshot/version refs + terminal triggers | PASS in reviewed path |
| Frozen governing config | No estimate FK/snapshot | FAIL |
| Frozen business identity/footer | Current config rendered later | FAIL |
| Canonical signed payload stored | Digest only | FAIL |
| Immutable rendered artifact | No PDF/HTML artifact store | FAIL |
| Hash can be independently verified | No canonical payload/read check | FAIL |
| Signer metadata stored | Name/time/event metadata | PARTIAL; outside hash/consent version absent |
| Link bound to document version | HMAC field exists, supplied null | FAIL |
| One active grant per purpose | Partial unique + revoke/insert CTE | PASS per purpose |
| Decision single-use | Estimate status + grant consume | PARTIAL; separate transactions |
| Historical render unaffected by config/deploy | Current config/current renderer | FAIL |

## Required remediation

Without broadly redesigning the estimate system:

1. Add a forward migration giving an issued/signed estimate an immutable `configuration_version_id` and canonical-document version.
2. At issue/sign, build one canonical JSON object containing every rendered business/document/customer/money/signature input. Store it and its versioned hash.
3. Persist a rendered immutable artifact, or prove a deterministic renderer from a pinned renderer version and the complete canonical object. An artifact is preferable for contractual evidence.
4. Render signed customer pages only from the stored snapshot/artifact. Current config may decorate surrounding navigation only if clearly outside the signed document.
5. Bind grants to the immutable document/delivery version and store a delivery record.
6. Perform estimate transition, audit event, and sign-grant consumption in one transaction.
7. Version the consent text and store the exact affirmative statement accepted.
8. Add read-time verification and an operator-visible integrity failure state; never silently fall back to current config.

## Required tests

- Sign an estimate, change every config field, and prove the artifact bytes/hash remain identical.
- Deploy a renderer change and prove old signed artifacts remain identical.
- Mutate an unsigned draft and prove a prior link/version becomes invalid or explicitly superseded.
- Race two customer decisions and prove one atomic winner plus consumed grant.
- Crash after status change but before grant consumption and prove rollback leaves neither committed.
- Verify hash algorithm/version migration without rewriting historical hashes.
- Prove a signed estimate can be exported and verified from stored evidence without reading current tenant config.

Until these pass, public copy and operator guidance should avoid claiming cryptographic non-repudiation or exact-document immutability.
