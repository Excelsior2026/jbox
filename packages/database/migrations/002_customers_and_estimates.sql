-- 002_customers_and_estimates.sql
--
-- Customers and estimates: the first tables to use the document identity
-- settled in docs/architecture/foundation-decisions.md §1.
--
-- Every document carries three identifiers doing three different jobs:
--   id              uuid    internal; the only thing foreign keys reference
--   document_number bigint  per-tenant sequence, from allocate_document_number()
--   display_id      text    human-facing, rendered once and frozen
--
-- Two tenants may both display 'PE-EST-0042'. Nothing collides, because
-- uniqueness is scoped to the organization and nothing joins on display_id.
--
-- MONEY
-- All amounts are integer cents. Rates are millipercent (1% = 1000) so no
-- ratio is ever stored as a float. Column names mirror @contractor-platform/money
-- exactly -- computeTotals() produces these fields and they are persisted
-- verbatim, so a stored estimate can be recomputed and compared.
--
-- money_version records which arithmetic produced the stored totals. Changing
-- the rounding rules means a new version, not a silent recomputation of
-- documents a customer already signed.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  document_number bigint NOT NULL CHECK (document_number > 0),
  display_id text NOT NULL CHECK (display_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 200),
  contact_name text NOT NULL DEFAULT '' CHECK (char_length(contact_name) <= 200),
  email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 320),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  service_address text NOT NULL DEFAULT '' CHECK (char_length(service_address) <= 200),
  town text NOT NULL DEFAULT '' CHECK (char_length(town) <= 100),
  postal_code text NOT NULL DEFAULT '' CHECK (char_length(postal_code) <= 20),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, display_id),
  -- Lets child tables carry organization_id and reference (id, organization_id)
  -- together, so a row cannot point at a parent belonging to another tenant.
  UNIQUE (id, organization_id)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS customers_org_updated_idx
  ON customers (organization_id, updated_at DESC, id);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Estimates
-- ---------------------------------------------------------------------------
-- draft -> signed | declined. Both end states are terminal: a signed estimate
-- is a contract and a declined one is a record. Revision happens by
-- duplicating into a new draft, never by reopening.

CREATE TABLE IF NOT EXISTS estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  document_number bigint NOT NULL CHECK (document_number > 0),
  display_id text NOT NULL CHECK (display_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  customer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'signed', 'declined')),

  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  -- Financial inputs (FinancialInputs)
  discount_millipercent integer NOT NULL DEFAULT 0
    CHECK (discount_millipercent BETWEEN 0 AND 100000),
  surcharge_cents bigint NOT NULL DEFAULT 0 CHECK (surcharge_cents >= 0),
  tax_rate_millipercent integer NOT NULL DEFAULT 0
    CHECK (tax_rate_millipercent >= 0),
  deposit_cents bigint NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),

  -- Computed totals (Totals), persisted verbatim
  subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  taxable_subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (taxable_subtotal_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  taxable_after_discount_cents bigint NOT NULL DEFAULT 0
    CHECK (taxable_after_discount_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),

  money_version integer NOT NULL DEFAULT 1 CHECK (money_version > 0),
  document_template_version text NOT NULL DEFAULT 'estimate-v1'
    CHECK (char_length(document_template_version) BETWEEN 1 AND 40),

  -- Set when the document is frozen. sha256 over the rendered document.
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  signed_at timestamptz,
  signed_by_name text CHECK (signed_by_name IS NULL OR char_length(signed_by_name) BETWEEN 2 AND 200),
  declined_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, display_id),
  UNIQUE (id, organization_id),

  FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,

  -- A signed estimate must carry the evidence that it was signed. Enforced
  -- here rather than in application code because it is the property that makes
  -- the row admissible as a record of agreement.
  CHECK (
    status <> 'signed'
    OR (content_hash IS NOT NULL AND signed_at IS NOT NULL AND signed_by_name IS NOT NULL)
  ),
  CHECK (status <> 'declined' OR declined_at IS NOT NULL),
  CHECK (status = 'signed' OR signed_at IS NULL),
  CHECK (status = 'declined' OR declined_at IS NULL),
  CHECK (taxable_subtotal_cents <= subtotal_cents)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS estimates_org_status_updated_idx
  ON estimates (organization_id, status, updated_at DESC, id);

-- migrate:split

CREATE INDEX IF NOT EXISTS estimates_customer_idx
  ON estimates (organization_id, customer_id, created_at DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Estimate line items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  estimate_id uuid NOT NULL,

  position integer NOT NULL CHECK (position >= 0),
  item_code text NOT NULL DEFAULT '' CHECK (char_length(item_code) <= 40),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),

  -- MoneyLineItem
  quantity_hundredths bigint NOT NULL CHECK (quantity_hundredths >= 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  taxable boolean NOT NULL DEFAULT true,

  -- Persisted so a frozen document does not depend on re-deriving the line.
  line_total_cents bigint NOT NULL CHECK (line_total_cents >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (estimate_id, position),
  FOREIGN KEY (estimate_id, organization_id)
    REFERENCES estimates (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS estimate_line_items_estimate_idx
  ON estimate_line_items (estimate_id, position);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Estimate events (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estimate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  estimate_id uuid NOT NULL,
  event text NOT NULL
    CHECK (event IN ('created', 'updated', 'lines_changed', 'signed', 'declined', 'duplicated')),
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (estimate_id, organization_id)
    REFERENCES estimates (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS estimate_events_estimate_created_idx
  ON estimate_events (estimate_id, created_at DESC, id DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Terminal-state immutability
-- ---------------------------------------------------------------------------
-- A signed estimate is a contract; a declined one is a record. Neither may be
-- edited afterwards, and the only permitted transition out of 'draft' is into
-- a terminal state.
--
-- In the database rather than the application because there is more than one
-- write path -- the field workspace, the customer signing link, and any future
-- import -- and they must not each be trusted to re-implement this.

CREATE OR REPLACE FUNCTION enforce_estimate_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'Estimate % is % and cannot be modified. Duplicate it into a new draft instead.',
      OLD.display_id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status <> OLD.status AND NEW.status NOT IN ('signed', 'declined') THEN
    RAISE EXCEPTION 'Unsupported estimate transition % -> %.', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER estimates_terminal_state
  BEFORE UPDATE ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION enforce_estimate_terminal_state();

-- migrate:split

-- Line rows follow the parent: once the estimate leaves draft, its lines are
-- part of the frozen document.
CREATE OR REPLACE FUNCTION enforce_estimate_lines_locked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  parent_estimate uuid := coalesce(NEW.estimate_id, OLD.estimate_id);
BEGIN
  SELECT status INTO parent_status FROM estimates WHERE id = parent_estimate;

  -- Absent parent means the estimate is being deleted and this row is
  -- cascading with it.
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Estimate lines cannot change once the estimate is %.', parent_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

-- migrate:split

CREATE TRIGGER estimate_line_items_locked
  BEFORE INSERT OR UPDATE OR DELETE ON estimate_line_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_estimate_lines_locked();

-- migrate:split

-- Events are append-only: an audit trail that can be rewritten is not one.
CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only.', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- migrate:split

CREATE TRIGGER estimate_events_append_only
  BEFORE UPDATE OR DELETE ON estimate_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE customers FORCE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE estimates FORCE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE estimate_line_items FORCE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE estimate_events ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE estimate_events FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY customers_tenant_isolation ON customers
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY estimates_tenant_isolation ON estimates
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY estimate_line_items_tenant_isolation ON estimate_line_items
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY estimate_events_tenant_isolation ON estimate_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON customers, estimates, estimate_line_items, estimate_events
  TO contractor_app;
