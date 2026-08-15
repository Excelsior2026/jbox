# Estimator Port Plan

Port the catalog-driven estimator, customer estimate presentation, and supporting
schema from `paris-electric-prototype` into this repository (jbox), per the
decision to do a **full-fidelity port** (vs. a pragmatic adaptation) of the
estimator-first scope.

Scope chosen (full-fidelity):
- Room walkthrough / plan-sketch markers
- Canvas signature capture (new `signature_image` column + storage)
- Offline `localStorage` draft buffer
- Draft-pricing / unverified-pricing warnings
- Price book catalog picker (published releases)
- Review / print
- Job + invoice association
- Estimate list card view + new-estimate modal
- Customer directory/detail polish

## Constraint that shapes everything

Migration 004 installs `enforce_line_item_price_source()`, a trigger on
`estimate_line_items` that **rejects `item_version_id` unless it belongs to a
PUBLISHED `price_book_releases` row**; `NULL item_version_id` is allowed. This is
stricter than the prototype (which allows draft/unverified pricing into documents
with warnings). Consequence:

- The catalog API may only serve items from a **published** release.
- Custom typed lines use `item_version_id = NULL` and are marked
  `price_origin = 'technician-custom'`.
- "Unverified pricing" in the DB can only come from `price_origin` provenance on
  the line (no version reference), so draft-pricing warnings are **adapted** into
  unverified/custom warnings rather than replicating draft-release pricing into
  documents 1:1. Document this in PORTING_LEDGER.md.

### Serving decision (adapted from the prototype)

The prototype estimator serves the current release (draft or published) with a
pricing-warning banner for drafts. jbox is stricter:

- `GET /api/field/price-book` serves **only the latest published release**; if no
  published release exists it returns `503 { error: 'Price book is not
  initialized' }`. Draft releases are structurally invisible (the migration-004
  trigger already blocks unpublished line pricing).
- The client falls back to the built-in starter catalog (`priceOrigin:
  'unverified'`); the offline/unverified warning banner replaces the prototype's
  draft-pricing banner. This is the documented adaptation.

### Data model delta (job association)

No `estimates.job_id` column. Association is modeled the jbox way:
`jobs.estimate_id → estimates` (migration 004 already has it); `HEADER_SELECT`
derives `job_id` via subquery.

## Job association adaptation (migration 011 + new libs/routes)

Ported scope: **job association only.** The invoice-conversion half of the
prototype (`estimate-invoice-association.tsx`, `invoices.ts` lib, `/api/field/invoices`
GET/POST) is **deferred** by scoping decision — jbox has no invoice-creation-from-
estimate flow yet and it is a subsystem of its own. The estimate's `jobId`/
`invoice` surfaces are unaffected; the invoice strip will slot in behind
`jobs.estimate_id` → `invoices.job_id` later.

`packages/database/migrations/011_job_estimate_association.sql` (new file):
- `job_events.event` CHECK gains `'estimate_linked'`.
- `estimate_events.event` CHECK gains `'job_linked'`.
- Partial unique index `jobs_estimate_id_uniq ON jobs (organization_id, estimate_id)
  WHERE estimate_id IS NOT NULL` — at most one job per estimate, so the derived
  `jobId` is never ambiguous and the "immutable association" claim is a DB rule.

New server files (all jbox-native, mirroring `estimates.ts`/`customers/route.ts`):
- `apps/product/src/lib/job-contract.ts` — `JOB_LIMITS` (title 2–200, notes ≤4000
  matching migration-004 CHECKs), `validateJobInput`. **No `serviceAddress`/`town`
  — jbox jobs have no such columns** (the prototype did); the working address
  lives on the customer record.
- `apps/product/src/lib/job-record.ts` — `JobRecord` exposes `displayId`,
  `estimateId`, `serviceRequestId` (uuid, not display id).
- `apps/product/src/lib/jobs.ts` — `getJob`, `listJobs({ customerId, status })`.
- `apps/product/src/lib/estimate-jobs.ts` — `linkEstimateToJob` /
  `createJobForEstimate`, both returning `{ estimate, job, reused }` or a
  classified failure. The guarded writes re-check every classification inside
  one statement (estimate `updated_at`/status, job cancelled/customer/
  service-request compatibility, one-job-per-estimate via the unique index);
  a raced no-op or `23505` unique violation is re-read and reclassified so
  same-link retries are idempotent. Both histories are logged (`job_events`
  `created`/`estimate_linked`, `estimate_events` `job_linked`) with
  `request_ip`/`user_agent` in `meta` per jbox's audit convention.
- `apps/product/src/app/api/field/jobs/route.ts` — `GET` (jobs.read) by
  `customerId`.
- `apps/product/src/app/api/field/estimates/[id]/job/route.ts` — `POST`
  (estimates.prepare + jobs.write, same-origin), body `{ expectedUpdatedAt,
  jobId? | newJob? }`; 404/409 classification mirrors the estimate PATCH route.
- `apps/product/src/app/field/estimates/estimate-job-association.tsx` — client
  port (modal with Existing/New tabs; form is title + notes only).
- Wired into `field-estimator.tsx` after the customer/job bar: `jobId` state,
  `prepareJobAssociation` (persists the draft first so `expectedUpdatedAt` is
  current, then returns it), `applyJobAssociation` (applies the returned record,
  sets `jobId`, messages with `job.displayId`).
- CSS appended to `field.module.css` (association strip + modal classes, jbox
  tokens).
- `job-contract.test.ts` — 8 validation tests.

Note: linking a job never touches `estimates.updated_at` (the edge lives on the
job row), so a link does not invalidate the estimator's `expectedUpdatedAt`.

## Data model deltas (migration 010)

`packages/database/migrations/010_estimate_estimator_fields.sql` (new file).

Follow the conventions of 002–009: `-- migrate:split` separators, `contractor_app`
grants, RLS is already enabled on estimates/estimate_line_items by earlier
migrations (verify before adding columns; new columns inherit table RLS).

`ALTER TABLE estimates ADD COLUMN`:
- `areas jsonb NOT NULL DEFAULT '[]'` — array of `{ id, name, floorPlanUrl? }`
- `signature_context text` — e.g. `'protected-published'`
- `signature_image text` — data-URL PNG; add
  `CHECK (signature_image IS NULL OR char_length(signature_image) <= 262144)`
  (no `job_id` column — association is `jobs.estimate_id`)

`ALTER TABLE estimate_line_items ADD COLUMN`:
- `area_id text` — free-text area key referencing `estimates.areas[].id`
- `price_origin text NOT NULL DEFAULT 'unverified'`
  `CHECK (price_origin IN ('published-price-book','technician-custom','unverified'))`
- `catalog_item_id uuid REFERENCES price_book_items(id) ON DELETE SET NULL`
- `release_id uuid REFERENCES price_book_releases(id) ON DELETE SET NULL`

Grants: `GRANT SELECT, INSERT, UPDATE ON ... ` stays inherited (column grants
already cover the table grant from 002/004 — verify no new grant needed; the
`GRANT ... ON estimates ...` in migration 002 should already cover new columns).

## Phase 1 — Schema + contract + record (server-side data model)

Files:
1. `packages/database/migrations/010_estimate_estimator_fields.sql` (above)
2. `apps/product/src/lib/estimate-contract.ts` — extend `EstimateLineInput` with
   `areaId: string | null`, `priceOrigin`, `catalogItemId`, `releaseId`; extend
   `EstimateDraftInput` with `areas`; keep validation strict (reject unknown price
   origins; area ids must exist in `areas` when present; published-origin lines
   must carry `itemVersionId`). Keep UUID_PATTERN / db `itemVersionId` names.
3. `apps/product/src/lib/estimate-record.ts` — add `areas`, `signatureContext`,
   `signatureImage`, `jobId` to record; line record adds `areaId`, `priceOrigin`,
   `catalogItemId`, `releaseId`.
4. `apps/product/src/lib/estimates.ts` — persist/read new fields in
   create/update/duplicate/get/list/sign SQL. `signature_image` written only on
   sign (route concern); updates read `areas`, `job_id`.
5. Unit tests in the same dirs (`estimate-contract.test.ts`, `estimate-record.test.ts`)
   mirroring the prototype's, extended for the new fields.

## Phase 2 — Presentation + price book API

Files:
1. `apps/product/src/lib/customer-estimate-presentation.ts` — port from
   `paris-electric-prototype/apps/product/src/lib/customer-estimate-presentation.ts`
   (already read). Keep `PriceBookSource`, price origins, signature contexts,
   `canPresentCustomerEstimate` logic. Adapt where the jbox DB differs (published-only).
2. `apps/product/src/lib/customer-estimate-presentation.test.ts` — port tests.
3. `apps/product/src/lib/price-book.ts` — read model for the catalog:
   published release, categories ordered by `position`, items with their current
   published version, `price_books.currency`, `price_book_releases.code`.
4. `apps/product/src/app/api/field/price-book/route.ts` — `GET`, field-principal
   gated (mirror `field-api-auth.ts` patterns in `api/field/customers/route.ts`),
   JSON shape matching the prototype estimator's expectation:
   `{ book: {...}, categories: [...], items: [...], nextCursor }`. Serve only
   published-release items. Offline/starter fallback lives client-side.
5. Sign route `apps/product/src/app/api/field/estimates/[id]/sign/route.ts` —
   extend body to accept `signatureImage` (data URL, ≤ 262144 chars after prefix)
   and `signatureContext`; persist `signature_image` alongside `signed_by_name`;
   keep same-origin + approve checks.

## Phase 3 — FieldEstimator component (the big port)

New file `apps/product/src/app/field/estimates/field-estimator.tsx`, adapted from
the prototype's 1792-line `field-estimator.tsx` (already read) to jbox's
contracts:

- State: areas, plan markers, line items (with `areaId`, `priceOrigin`,
  `catalogItemId`, `versionId`, `releaseId`), internal notes (`notes` field),
  price book release, customer/contact selection, signature canvas.
- Catalog picker: fetch `/api/field/price-book`; search by name/code; add item →
  line with `priceOrigin: 'published-price-book'`; typed custom line →
  `priceOrigin: 'technician-custom'`; offline starter catalog →
  `priceOrigin: 'unverified'` with warning badge.
- Room walkthrough / plan markers: port the marker layer + dimension inputs.
- `localStorage` draft buffer: reuse the prototype's `DRAFT_STORAGE_KEY` scheme
  (jbox keys: `jbox-field-estimate:new` create, `jbox-field-estimate:{id}`
  durable backups) — `restoreAreas`, `saveDraft`, `persistDurableDraft`.
- Review/print: totals via `@/packages/money` `computeTotals`; print layout.
- Create-on-save: first Save/Sign POSTs `/api/field/estimates` (create) then
  `window.history.replaceState` to `/field/estimates/{id}` without unmounting;
  subsequent saves PATCH via `/api/field/estimates/[id]`. Duplicate, delivery,
  decline via existing routes.
- Job/invoice association: **job association DONE** (see the adaptation section
  above — migration 011, `estimate-jobs.ts`, `/api/field/jobs`,
  `/api/field/estimates/[id]/job`, `estimate-job-association.tsx`, wired into the
  estimator). Invoice conversion (`estimate-invoice-association.tsx` port) is
  **DEFERRED** — needs a whole invoice-creation-from-estimate subsystem in jbox.
- **Status: DONE for the estimator itself.** Component written (~1732 lines),
  typechecks clean, wired into the new + edit pages.

## Phase 4 — Pages + CSS + list/detail polish

Files:
1. `apps/product/src/app/field/estimates/new/page.tsx` — render FieldEstimator
   in create mode. **DONE** (+ `?customerId=` prefill from the directory).
2. `apps/product/src/app/field/estimates/[id]/edit/page.tsx` — render in edit
   mode, seeded from record, guarded to draft status. **DONE.**
3. `apps/product/src/app/field/estimates/page.tsx` — card grid + new-estimate
   modal (port `estimates-list.tsx`). **DONE** (`NewEstimateButton` client
   component: search existing customer / add new, then deep-link
   `/field/estimates/new?customerId=`).
4. `apps/product/src/app/field/field.module.css` — estimator styles appended
   (port of prototype classes adapted to jbox tokens). **DONE**, including the
   estimate list card view, new-estimate modal, customer directory/detail polish,
   and the job-association strip + modal.
5. `estimate-actions.tsx` — keep for decline/deliver/duplicate on the detail
   page. `estimate-editor.tsx` — **DELETED** (unused; both pages render
   FieldEstimator).
6. Customer directory card grid + detail recent-estimates panel. **DONE.**

## Phase 5 — Verification

**DONE 2026-08-14.** Full chain green:
1. `npm run verify:ci` — secrets:check, lint, test, build:all, audit all pass.
2. **Pre-existing MFA fixes (commit d6525df, on main, were broken):**
   - `lib/mfa.ts` — otplib is v13.4.1 (functional API); the v12 `authenticator`
     singleton no longer exists. Rewrote `generateTotpSecret`/`getTotpUri`/
     `verifyTotpToken` on `generateSecret`/`generateURI`/`verifySync`.
     Also typed `AuthenticatedStaff.role` (and the mfa payload role) as
     `ApplicationRole` and removed `'mfa-required'` from the plain false-branch
     of `LoginResult`, which was defeating union narrowing in the login route.
   - `app/api/auth/mfa/enroll/route.ts` and `setup/route.ts` — removed unused
     `readFieldSessionToken` imports (lint errors).
3. **Migration 009 was un-runnable** (`cannot change return type of existing
   function` — `CREATE OR REPLACE` cannot add `totp_secret` to the two
   functions 007 created). Fixed by `DROP FUNCTION IF EXISTS` before each
   recreate (grants re-issued in the same migration). 009 had never applied to
   any branch, so editing it is safe.
4. Migrations 009 + 010 + 011 applied to the dev branch; `db:status` reports
   `up to date`; `field.sql` checks pass.
5. Manual exercise of the new estimate + job-link flows still worth a pass.

## Sequencing / handoff notes

- Each phase ends green (`verify:ci` passes). If a phase is interrupted, the plan
  document stays the source of truth; resume at the incomplete phase.
- Anything already verified in earlier investigation:
  - jbox `estimate-record.ts`, `estimate-contract.ts`, `estimates.ts`,
    `estimate-document.ts` (contentHash via `canonicalize`), migration 002/003/004,
    money package (`computeTotals`, `divRoundHalfUp`), sign route, field routes
    (customers/estimates/decline/delivery/duplicate/sign).
  - Prototype `field-estimator.tsx` (1792 l), `customer-estimate-presentation.ts`,
    `estimates-list.tsx`, `estimate-job-association.tsx`, `estimate-invoice-association.tsx`,
    `field.module.css` (4904 l), `estimate-record.ts`, `estimate-contract.ts`.
- Open decision noted for later: whether to keep `estimate-editor.tsx` for
  fallback or delete it; default is to replace it with FieldEstimator.
