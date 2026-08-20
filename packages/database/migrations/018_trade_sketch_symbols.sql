-- Migration 018: Trade-Specific Canvas Symbols & Tenant Price Book Binding
-- Phase 3: Sketch Takeoff, Dispatch Portal, J-Box Workspace

-- ---------------------------------------------------------------------------
-- 1. Add trade_category to organizations
-- ---------------------------------------------------------------------------

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS trade_category text NOT NULL DEFAULT 'general'
    CHECK (trade_category IN ('electrical', 'plumbing', 'hvac', 'general'));

-- migrate:split

-- ---------------------------------------------------------------------------
-- 2. Master system definitions for sketch symbols
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canvas_symbol_definitions (
  id text PRIMARY KEY,
  trade_category text NOT NULL
    CHECK (trade_category IN ('electrical', 'plumbing', 'hvac', 'general')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  category text NOT NULL
    CHECK (category IN ('fixtures', 'equipment', 'piping_wiring', 'controls')),
  icon_svg_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:split

-- ---------------------------------------------------------------------------
-- 3. Tenant symbol mapping (binds canvas icons to tenant price book items)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_canvas_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE CASCADE,
  symbol_id text NOT NULL
    REFERENCES canvas_symbol_definitions(id) ON DELETE CASCADE,
  custom_label text CHECK (custom_label IS NULL OR char_length(custom_label) BETWEEN 1 AND 100),
  price_book_item_id uuid
    REFERENCES price_book_items(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, symbol_id)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS idx_tenant_canvas_symbols_org
  ON tenant_canvas_symbols (organization_id) WHERE is_active = true;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 4. Seed master system symbols by trade category
-- ---------------------------------------------------------------------------

INSERT INTO canvas_symbol_definitions (id, trade_category, display_name, category, icon_svg_path) VALUES
  -- PLUMBING
  ('plumb_water_heater',      'plumbing',  'Water Heater',                  'fixtures',     'M12 2v20m-8-10h16'),
  ('plumb_tankless_wh',       'plumbing',  'Tankless Water Heater',         'fixtures',     'M4 4h16v16H4z'),
  ('plumb_water_closet',      'plumbing',  'Water Closet / Toilet',         'fixtures',     'M6 8a4 4 0 018 0v4H6z'),
  ('plumb_floor_drain',       'plumbing',  'Floor Drain',                   'piping_wiring','M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0'),
  ('plumb_main_shutoff',      'plumbing',  'Main Shut-off Valve',           'controls',     'M8 12h8m-4-4v8'),
  -- HVAC & MECHANICAL
  ('hvac_condenser',          'hvac',      'Outdoor Condenser / Heat Pump', 'equipment',    'M3 3h18v18H3zM8 12h8'),
  ('hvac_air_handler',        'hvac',      'Indoor Air Handler / Furnace',  'equipment',    'M4 6h16v12H4z'),
  ('hvac_flex_duct',          'hvac',      'Flex Duct Run',                 'piping_wiring','M2 12c4-4 8 4 12 0s8 4 12 0'),
  ('hvac_supply_vent',        'hvac',      'Supply Register',               'fixtures',     'M5 5h14v14H5zM5 12h14'),
  ('hvac_thermostat',         'hvac',      'Smart Thermostat',              'controls',     'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0'),
  -- ELECTRICAL
  ('elec_duplex_outlet',      'electrical','20A Duplex Receptacle',         'fixtures',     'M12 2a10 10 0 100 20 10 10 0 000-20z'),
  ('elec_gfci_outlet',        'electrical','GFCI Protected Receptacle',     'fixtures',     'M4 4h16v16H4zM9 12h6'),
  ('elec_panel_200a',         'electrical','200A Main Breaker Panel',       'controls',     'M6 2h12v20H6z'),
  ('elec_led_highbay',        'electrical','Commercial High-Bay LED',       'fixtures',     'M12 3l9 6-9 6-9-6 9-6z')
ON CONFLICT (id) DO NOTHING;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 5. RLS for new tables
-- ---------------------------------------------------------------------------

ALTER TABLE canvas_symbol_definitions ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE canvas_symbol_definitions FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE tenant_canvas_symbols ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE tenant_canvas_symbols FORCE ROW LEVEL SECURITY;

-- migrate:split

-- canvas_symbol_definitions is a shared read-only table; RLS scoped to tenant
CREATE POLICY canvas_symbol_definitions_tenant_read ON canvas_symbol_definitions
  FOR SELECT TO contractor_app
  USING (true);

-- migrate:split

-- platform_runtime can read/write symbol definitions (seed, admin)
CREATE POLICY canvas_symbol_definitions_platform_all ON canvas_symbol_definitions
  FOR ALL TO platform_runtime
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY tenant_canvas_symbols_tenant_isolation ON tenant_canvas_symbols
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY tenant_canvas_symbols_platform_all ON tenant_canvas_symbols
  FOR ALL TO platform_runtime
  USING (true)
  WITH CHECK (true);

-- migrate:split

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

GRANT SELECT
  ON canvas_symbol_definitions
  TO contractor_app;

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON tenant_canvas_symbols
  TO contractor_app;

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON canvas_symbol_definitions, tenant_canvas_symbols
  TO platform_runtime;
