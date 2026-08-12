-- seed-dev-tenant.sql
--
-- Idempotent dev-tenant seed: one active organization ("paris-dev", Paris
-- Electric), its canonical verified storefront hostname, the in-force config-v1
-- document the storefront renders, and smoke customers + a draft estimate so the
-- Field UI has data on first open.
--
-- Safe to re-run: every insert is guarded (ON CONFLICT / NOT EXISTS), and the
-- record counters are pre-seeded so later app-created documents can never
-- collide with the smoke display ids.
--
--   node --env-file=.env.local packages/database/seed-dev-tenant.mjs
--
-- Dev-only. A production tenant is provisioned through the control plane, which
-- is what gives it its real Clerk organization link and verified hostname.

BEGIN;

-- ---------------------------------------------------------------------------
-- Control plane: the organization and its tenant boundary hostname
-- ---------------------------------------------------------------------------
SET LOCAL ROLE control_app;

INSERT INTO organizations (id, slug, display_name, status)
VALUES ('de000000-0000-0000-0000-000000000001', 'paris-dev', 'Paris Electric', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO organization_domains (organization_id, hostname, is_canonical, verified, verified_at)
VALUES ('de000000-0000-0000-0000-000000000001', 'paris.usejbox.com', true, true, now())
ON CONFLICT (hostname) DO NOTHING;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Tenant plane: as contractor_app under the org context, the path the Field API
-- uses. The counter rows fix next allocation at customer #3 / estimate #2 so a
-- later app-created document number cannot collide with the seeded display ids.
-- ---------------------------------------------------------------------------
SELECT set_application_context('de000000-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
SET LOCAL ROLE contractor_app;

INSERT INTO organization_record_counters (organization_id, record_kind, next_value)
VALUES
  ('de000000-0000-0000-0000-000000000001', 'customer', 3),
  ('de000000-0000-0000-0000-000000000001', 'estimate', 2)
ON CONFLICT (organization_id, record_kind) DO NOTHING;

INSERT INTO configuration_versions
  (organization_id, version, status, document_version, document, created_by, approved_at)
VALUES (
  'de000000-0000-0000-0000-000000000001', 1, 'approved', 'config-v1',
  $config${
    "version": "config-v1",
    "templateId": "heritage-craft",
    "catalogVersion": 1,
    "brand": {
      "primaryColor": "#1d4ed8",
      "accentColor": "#f59e0b",
      "surfaceColor": "#ffffff"
    },
    "identity": {
      "businessName": "Paris Electric",
      "tagline": "Licensed residential & commercial electricians"
    },
    "contact": {
      "phone": "(631) 555-0100",
      "email": "hello@paris.test",
      "address": "11 Main St, Smithtown, NY 11787",
      "hours": "Mon-Fri 8a-5p"
    },
    "serviceArea": {
      "description": "Suffolk County and eastern Long Island"
    },
    "services": [
      { "slug": "panel-upgrades", "name": "Panel upgrades", "description": "200A and 400A panel and meter replacements.", "priceFromCents": 450000 },
      { "slug": "rewiring", "name": "Whole-home rewiring", "description": "Knob-and-tube replacement and full rewires.", "priceFromCents": 1200000 },
      { "slug": "ev-charging", "name": "EV charger installation", "description": "Level 2 chargers, from inspection to outlet.", "priceFromCents": 85000 },
      { "slug": "emergency-service", "name": "24/7 emergency service", "description": "Outages, sparking, and panel emergencies.", "priceFromCents": null }
    ],
    "hero": {
      "headline": "Electricians Long Island trusts",
      "subheadline": "Family-run since 1998 — panels, rewires, and EV chargers."
    },
    "about": {
      "body": "Paris Electric is a family-run licensed electrical contractor serving Suffolk County since 1998. We design and install panel upgrades, full rewires, and EV charging stations, and we answer the phone when the lights go out."
    },
    "documents": {
      "prefixes": { "customer": "CUS", "estimate": "EST", "serviceRequest": "SRQ", "job": "JOB", "invoice": "INV", "receipt": "RCT" }
    },
    "tax": { "taxRateMillipercent": 8625 }
  }$config$,
  NULL,
  now()
)
ON CONFLICT (organization_id, version) DO NOTHING;

INSERT INTO customers
  (id, organization_id, document_number, display_id, display_name, contact_name, email, phone, service_address, town, postal_code, notes)
VALUES
  ('c0000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000001', 1, 'PE-CUS-0001',
   'Marisol Ortega', 'Marisol Ortega', 'marisol@example.test', '6315550142',
   '21 Harbor Rd', 'Port Jefferson', '11777', ''),
  ('c0000000-0000-0000-0000-000000000002', 'de000000-0000-0000-0000-000000000001', 2, 'PE-CUS-0002',
   'Harbor View Condos', 'Dana Reyes', 'dana@example.test', '6315550199',
   '4 Marina Way', 'Stony Brook', '11790', 'Maintenance contract')
ON CONFLICT (organization_id, display_id) DO NOTHING;

INSERT INTO estimates
  (id, organization_id, document_number, display_id, customer_id, status, title, notes, scope, exclusions,
   discount_millipercent, surcharge_cents, tax_rate_millipercent, deposit_cents,
   subtotal_cents, taxable_subtotal_cents, discount_cents, taxable_after_discount_cents, tax_cents, total_cents,
   money_version, document_template_version)
VALUES (
  'e0000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000001', 1, 'PE-EST-0001',
  'c0000000-0000-0000-0000-000000000001', 'draft',
  '200A panel upgrade',
  'Seeded draft for development smoke tests.',
  'Replace the existing 200A main panel with a new 42-space panel, install a new meter socket and ground rod, and bring the grounding up to current code.',
  'Excludes drywall repair, sub-panel feeders, and any knob-and-tube circuits beyond the panel.',
  0, 0, 8625, 0,
  535000, 535000, 0, 535000, 46144, 581144,
  1, 'estimate-v1'
)
ON CONFLICT (organization_id, display_id) DO NOTHING;

INSERT INTO estimate_line_items
  (organization_id, estimate_id, position, item_code, description, quantity_hundredths, unit_price_cents, taxable, line_total_cents)
VALUES
  ('de000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 0, 'PANEL-200',
   '200A panel upgrade, 42-space, with permit', 100, 450000, true, 450000),
  ('de000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 1, 'CIRC-20A',
   'New 20A circuit to garage', 100, 85000, true, 85000)
ON CONFLICT (estimate_id, position) DO NOTHING;

INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
SELECT 'de000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'created', NULL, '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM estimate_events
  WHERE estimate_id = 'e0000000-0000-0000-0000-000000000001' AND event = 'created'
);

RESET ROLE;

COMMIT;
