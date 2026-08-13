# Control Plane

The control plane is the operator API for onboarding tenants. It lives in
`apps/control` (deployed as `jbox-control`) and owns exactly one business
concern: turning an onboarding contract into a tenant that passes every gate
the product app enforces, so `activate` is a formality and never a discovery.

## Roles and RLS model

Production logins (see `DATABASE_SETUP.md`):

- `jbox_runtime` — the product app's login. Member of `contractor_app` and
  `platform_runtime`.
- `jbox_control` — the control plane's login. Member of `control_app` **and**
  `contractor_app`. No `BYPASSRLS` anywhere.

Every tenant table is `FORCE ROW LEVEL SECURITY`. The control plane never
touches tenant content as an owner or a superuser; it writes it as the same
role the product app uses, so the row policy decisions are identical to what
production traffic would face.

The mechanism is one transaction of ordered statements executed by
`apps/control/src/lib/control-db.ts`:

1. **`control_app`** for control-owned rows: the `organizations` row and the
   `organization_domains` row. The platform RLS grants `control_app` full
   access to these.
2. **`set_application_context($orgId, NULL, $requestId)`** — switches the
   transaction into the tenant's context.
3. **`contractor_app`** for tenant-owned rows: the record counters, the
   `configuration_versions` config-v1 document, and the price book release.

Each statement declares the role it must run as; the executor issues
`SET LOCAL ROLE` only when the role actually changes. If any statement fails,
the whole transaction rolls back and no tenant is half-created.

The product app resolves tenants by hostname against `organization_domains`
and only treats a host as real when the domain is `verified` and the
organization is `active` — the exact state the control plane produces.

## The onboarding contract

`POST /api/organizations`, body:

```jsonc
{
  "slug": "paris-electric",            // organizations.slug — URL-safe, globally unique
  "displayName": "Paris Electric",
  "canonicalHostname": "paris.usejbox.com",
  "clerkOrganizationId": "org_…",      // optional; linked when Clerk org-sync is wired
  "config": {                          // config-v1, see buildConfigDocument
    "identity":  { "businessName": "…", "tagline": "…" },
    "brand":     { "primaryColor": "…", "accentColor": "…", "surfaceColor": "…", "templateId": "…" },
    "contact":   { "phone": "…", "email": "…", "address": "…", "hours": "…" },
    "serviceArea": { "description": "…" },
    "services":  [ { "id": "residential", "name": "…", "description": "…", "position": 1 } ],
    "documents": { "estimatePrefix": "PE" }
  },
  "priceBook": {                       // optional; if present it is published as release v1
    "name": "Paris Electric v1",
    "categories": [ { "name": "…", "items": [ { "key": "…", "label": "…", "unit": "…", "defaultRateCents": 0, "position": 1 } ], "position": 1 } ]
  }
}
```

On success the tenant is created atomically in `provisioning` state with
`configVersion: 1` approved and (if given) the price book published.

## Lifecycle

| Step | Endpoint | Effect |
|---|---|---|
| Provision | `POST /api/organizations` | Create tenant in `provisioning` state |
| Readiness | `GET /api/organizations/[id]` | Report domain/config/price-book gates |
| Verify DNS | `POST /api/organizations/[id]` `{ "action": "verify-domain" }` | Mark canonical hostname verified (do this **only after** the DNS record resolves) |
| Activate | `POST /api/organizations/[id]` `{ "action": "activate" }` | Gate-check, then flip `status → active` |

All endpoints require `Authorization: Bearer $CONTROL_API_TOKEN` (timing-safe
compare). `GET /api/organizations` lists tenants newest-first.

`activate` refuses if any gate is open: the canonical hostname is not
verified, the tenant has no approved configuration, or the price book has no
published release. There is deliberately no force flag.

## Deploy and DNS

- Both apps deploy on Vercel, project `jbox-control` (root `apps/control`) and
  `jbox-product` (root `apps/product`).
- Builds use `output: process.env.VERCEL ? undefined : 'standalone'` — the
  standalone output is for self-hosting only and breaks the Vercel build.
- Control plane production env vars: `CONTROL_DATABASE_URL`,
  `CONTROL_DATABASE_URL_UNPOOLED`, `CONTROL_API_TOKEN`. Product app:
  `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.
- `CONTROL_API_TOKEN` is 24 bytes of random hex. It is also stored locally in
  the gitignored `apps/control/.env.local`; keep the local copy and the Vercel
  value in sync or rotate both.
- Onboarding a new tenant: provision → add `tenant.usejbox.com` as a domain on
  the `jbox-product` Vercel project and point DNS at the returned target →
  confirm resolution → `verify-domain` → `activate`.

## Production record: Paris Electric

- Organization `db010ee7-cff4-44ca-8444-bcc969e607ba`, slug `paris-electric`.
- Hostname `paris.usejbox.com`, verified, organization `active`.
- Configuration `config-v1` version 1 approved; prefix `PE`.
- Price book `Paris Electric v1` published: 5 categories, 17 items, 8.625% tax.
- Live storefront at `https://paris.usejbox.com` (home, `/services`,
  `/request`); browser title is the tenant business name.
