-- 004_service_requests_jobs_invoices_receipts_inventory.sql
--
-- The rest of the Field suite, on top of 001-003.
--
--   - service_requests  the storefront inbox: a visitor's request enters here,
--                       staff convert it into a customer + estimate.
--   - jobs              work resulting from a signed estimate (or a service
--                       request). Scheduling and status; no money of its own.
--   - invoices          draft -> issued | cancelled; issued freezes the content
--                       (it is what a customer was asked to pay), paid records
--                       settlement. Carries the same FinancialInputs/Totals
--                       money model as estimates.
--   - receipts          a settlement record. Created issued and immutable.
--   - inventory         quantity only in v1 (costing method is deferred);
--                       movements are an append-only ledger.
--
-- PRICE PROVENANCE (decisions 5 and 6 in foundation-decisions.md)
-- estimate_line_items and invoice_line_items gain an item_version_id that may
-- reference a price book version. The structural rule "unpublished pricing
-- cannot enter a commercial document" is enforced by trigger: a line may only
-- carry a version that belongs to a PUBLISHED release of the same tenant.
--
-- The document identity model is unchanged: surrogate uuid, per-tenant
-- document_number from allocate_document_number(), frozen display_id. Adding
-- 'service_request' to the record counter kinds is the one alteration to 001.

-- ---------------------------------------------------------------------------
-- Record counters accept the new document kind
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ALTER TABLE organization_record_counters
    DROP CONSTRAINT IF EXISTS organization_record_counters_record_kind_check;
  ALTER TABLE organization_record_counters
    ADD CONSTRAINT organization_record_counters_record_kind_check
    CHECK (record_kind IN
      ('customer', 'estimate', 'service_request', 'job', 'invoice', 'receipt', 'purchase_order'));
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Service requests (storefront inbox)
-- ---------------------------------------------------------------------------
-- customer_id is nullable: a request arrives from the public storefront and
-- only becomes a customer when staff convert it. The contact fields are the
-- requestor's self-described details, snapshotted on the request.

CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  document_number bigint NOT NULL CHECK (document_number > 0),
  display_id text NOT NULL CHECK (display_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'accepted', 'declined')),
  source text NOT NULL DEFAULT 'storefront' CHECK (source IN ('storefront', 'phone', 'walkin', 'email')),

  customer_id uuid,
  contact_name text NOT NULL CHECK (char_length(contact_name) BETWEEN 1 AND 200),
  contact_email text NOT NULL DEFAULT '' CHECK (char_length(contact_email) <= 320),
  contact_phone text NOT NULL DEFAULT '' CHECK (char_length(contact_phone) <= 40),
  service_address text NOT NULL DEFAULT '' CHECK (char_length(service_address) <= 200),
  town text NOT NULL DEFAULT '' CHECK (char_length(town) <= 100),
  postal_code text NOT NULL DEFAULT '' CHECK (char_length(postal_code) <= 20),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 4000),

  handled_at timestamptz,
  handled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, display_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  CHECK (status <> 'accepted' OR (handled_at IS NOT NULL AND handled_by IS NOT NULL))
);

-- migrate:split

CREATE INDEX IF NOT EXISTS service_requests_org_status_created_idx
  ON service_requests (organization_id, status, created_at DESC, id);

-- migrate:split

CREATE TABLE IF NOT EXISTS service_request_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  service_request_id uuid NOT NULL,
  storage_key text NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 500),
  filename text NOT NULL DEFAULT '' CHECK (char_length(filename) <= 255),
  content_type text NOT NULL DEFAULT 'application/octet-stream'
    CHECK (char_length(content_type) BETWEEN 1 AND 100),
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (storage_key),
  FOREIGN KEY (service_request_id, organization_id)
    REFERENCES service_requests (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS service_request_photos_request_idx
  ON service_request_photos (service_request_id, position);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
-- A job is working life, not a contract: it is editable, and status is a
-- working state rather than a frozen record. estimate_id is the signed
-- estimate that justified the work; service_request_id ties the inbound lead.

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  document_number bigint NOT NULL CHECK (document_number > 0),
  display_id text NOT NULL CHECK (display_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  customer_id uuid NOT NULL,
  estimate_id uuid,
  service_request_id uuid,

  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  scheduled_start_at timestamptz,
  completed_at timestamptz,
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, display_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (estimate_id, organization_id)
    REFERENCES estimates (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (service_request_id, organization_id)
    REFERENCES service_requests (id, organization_id) ON DELETE SET NULL,
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS jobs_org_status_scheduled_idx
  ON jobs (organization_id, status, scheduled_start_at, id);

-- migrate:split

CREATE INDEX IF NOT EXISTS jobs_customer_idx
  ON jobs (organization_id, customer_id, created_at DESC);

-- migrate:split

CREATE TABLE IF NOT EXISTS job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  event text NOT NULL
    CHECK (event IN
      ('created', 'status_changed', 'scheduled', 'note_added', 'materials_added', 'completed', 'cancelled')),
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (job_id, organization_id)
    REFERENCES jobs (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS job_events_job_created_idx
  ON job_events (job_id, created_at DESC, id DESC);

-- migrate:split

CREATE TRIGGER job_events_append_only
  BEFORE UPDATE OR DELETE ON job_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ---------------------------------------------------------------------------
-- Inventory (quantity only; costing method deferred)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  unit text NOT NULL DEFAULT 'ea' CHECK (unit ~ '^[a-z]{1,8}$'),
  quantity_hundredths bigint NOT NULL DEFAULT 0 CHECK (quantity_hundredths >= 0),
  reorder_threshold_hundredths bigint CHECK (
    reorder_threshold_hundredths IS NULL OR reorder_threshold_hundredths > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, code),
  UNIQUE (id, organization_id)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS inventory_items_org_active_idx
  ON inventory_items (organization_id, active, code);

-- migrate:split

-- Append-only movement ledger. The running balance lives on the item; this is
-- the evidence. delta_hundredths is signed (positive in, negative out) and the
-- application updates quantity_hundredths in the same transaction.
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL,
  delta_hundredths bigint NOT NULL CHECK (delta_hundredths <> 0),
  reason text NOT NULL
    CHECK (reason IN ('initial', 'purchase', 'used_on_job', 'adjustment')),
  job_id uuid,
  reference text NOT NULL DEFAULT '' CHECK (char_length(reference) <= 100),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (inventory_item_id, organization_id)
    REFERENCES inventory_items (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (job_id, organization_id)
    REFERENCES jobs (id, organization_id) ON DELETE SET NULL
);

-- migrate:split

CREATE INDEX IF NOT EXISTS inventory_transactions_item_created_idx
  ON inventory_transactions (inventory_item_id, created_at DESC, id DESC);

-- migrate:split

CREATE TRIGGER inventory_transactions_append_only
  BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- Material consumed on a job, as a snapshot of what was used and from which
-- inventory item. The inventory balance is adjusted by the application in the
-- same transaction; this table is the record of consumption.
CREATE TABLE IF NOT EXISTS job_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  quantity_hundredths bigint NOT NULL CHECK (quantity_hundredths > 0),
  unit text NOT NULL DEFAULT 'ea' CHECK (unit ~ '^[a-z]{1,8}$'),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (job_id, organization_id)
    REFERENCES jobs (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id, organization_id)
    REFERENCES inventory_items (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS job_materials_job_idx
  ON job_materials (job_id, created_at);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
-- draft -> issued | cancelled; issued -> paid | cancelled. issued freezes the
-- content a customer was asked to pay (same immutability model as a signed
-- estimate); paid records settlement and may set paid_at. The money columns
-- mirror @contractor-platform/money exactly, like estimates.

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  document_number bigint NOT NULL CHECK (document_number > 0),
  display_id text NOT NULL CHECK (display_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  customer_id uuid NOT NULL,
  job_id uuid,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),

  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  due_at timestamptz,

  -- FinancialInputs
  discount_millipercent integer NOT NULL DEFAULT 0
    CHECK (discount_millipercent BETWEEN 0 AND 100000),
  surcharge_cents bigint NOT NULL DEFAULT 0 CHECK (surcharge_cents >= 0),
  tax_rate_millipercent integer NOT NULL DEFAULT 0
    CHECK (tax_rate_millipercent >= 0),
  deposit_cents bigint NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),

  -- Totals, persisted verbatim
  subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  taxable_subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (taxable_subtotal_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  taxable_after_discount_cents bigint NOT NULL DEFAULT 0
    CHECK (taxable_after_discount_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),

  money_version integer NOT NULL DEFAULT 1 CHECK (money_version > 0),
  document_template_version text NOT NULL DEFAULT 'invoice-v1'
    CHECK (char_length(document_template_version) BETWEEN 1 AND 40),

  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, display_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (job_id, organization_id)
    REFERENCES jobs (id, organization_id) ON DELETE RESTRICT,
  CHECK (status <> 'issued' OR issued_at IS NOT NULL),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CHECK (status = 'paid' OR paid_at IS NULL),
  CHECK (status = 'cancelled' OR cancelled_at IS NULL),
  CHECK (taxable_subtotal_cents <= subtotal_cents)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS invoices_org_status_updated_idx
  ON invoices (organization_id, status, updated_at DESC, id);

-- migrate:split

CREATE INDEX IF NOT EXISTS invoices_customer_idx
  ON invoices (organization_id, customer_id, created_at DESC);

-- migrate:split

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,

  position integer NOT NULL CHECK (position >= 0),
  item_code text NOT NULL DEFAULT '' CHECK (char_length(item_code) <= 40),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  item_version_id uuid,

  -- MoneyLineItem
  quantity_hundredths bigint NOT NULL CHECK (quantity_hundredths >= 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  taxable boolean NOT NULL DEFAULT true,
  line_total_cents bigint NOT NULL CHECK (line_total_cents >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (invoice_id, position),
  FOREIGN KEY (invoice_id, organization_id)
    REFERENCES invoices (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (item_version_id, organization_id)
    REFERENCES price_book_item_versions (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx
  ON invoice_line_items (invoice_id, position);

-- migrate:split

CREATE TABLE IF NOT EXISTS invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  event text NOT NULL
    CHECK (event IN ('created', 'updated', 'issued', 'paid', 'cancelled')),
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (invoice_id, organization_id)
    REFERENCES invoices (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS invoice_events_invoice_created_idx
  ON invoice_events (invoice_id, created_at DESC, id DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------
-- A settlement record: created issued and immutable. amount_cents is what was
-- received, method is how; the invoice's total is the amount owed.

CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  document_number bigint NOT NULL CHECK (document_number > 0),
  display_id text NOT NULL CHECK (display_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),

  invoice_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status = 'issued'),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  method text NOT NULL CHECK (method IN ('card', 'cash', 'check', 'transfer')),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, display_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (invoice_id, organization_id)
    REFERENCES invoices (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS receipts_invoice_idx
  ON receipts (organization_id, invoice_id, issued_at DESC);

-- migrate:split

CREATE TRIGGER receipts_append_only
  BEFORE UPDATE OR DELETE ON receipts
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ---------------------------------------------------------------------------
-- Price provenance on line items
-- ---------------------------------------------------------------------------
-- Structural enforcement of "unpublished pricing cannot enter a commercial
-- document" (foundation-decisions.md §5). A line may reference a price book
-- version only when that version belongs to a PUBLISHED release of the same
-- tenant. Draft pricing is invisible to documents by construction.

CREATE OR REPLACE FUNCTION enforce_line_item_price_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  published_version boolean;
BEGIN
  IF NEW.item_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM price_book_release_items AS release_item
    JOIN price_book_releases AS release
      ON release.id = release_item.release_id
    WHERE release_item.item_version_id = NEW.item_version_id
      AND release.status = 'published'
      AND release.organization_id = NEW.organization_id
  ) INTO published_version;

  IF NOT published_version THEN
    RAISE EXCEPTION
      'Line items may only reference a price book version that is in a published release.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER estimate_line_items_price_source
  BEFORE INSERT OR UPDATE ON estimate_line_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_line_item_price_source();

-- migrate:split

CREATE TRIGGER invoice_line_items_price_source
  BEFORE INSERT OR UPDATE ON invoice_line_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_line_item_price_source();

-- migrate:split

-- The estimate lines table existed before this migration: add provenance.
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS item_version_id uuid;

-- migrate:split

ALTER TABLE estimate_line_items
  ADD CONSTRAINT estimate_line_items_item_version_fk
  FOREIGN KEY (item_version_id, organization_id)
  REFERENCES price_book_item_versions (id, organization_id) ON DELETE RESTRICT;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Invoice terminal-state immutability
-- ---------------------------------------------------------------------------
-- issued freezes the content a customer was asked to pay; paid and cancelled
-- are terminal. The one permitted mutation to an issued invoice is marking it
-- paid (or cancelled).

CREATE OR REPLACE FUNCTION enforce_invoice_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION
      'Invoice % is % and cannot be modified.', OLD.display_id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'issued' THEN
    IF NEW.status NOT IN ('issued', 'paid', 'cancelled') THEN
      RAISE EXCEPTION 'Unsupported invoice transition % -> %.', OLD.status, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.status = 'issued'
       AND (
         NEW.customer_id IS DISTINCT FROM OLD.customer_id
         OR NEW.job_id IS DISTINCT FROM OLD.job_id
         OR NEW.title IS DISTINCT FROM OLD.title
         OR NEW.notes IS DISTINCT FROM OLD.notes
         OR NEW.due_at IS DISTINCT FROM OLD.due_at
         OR NEW.discount_millipercent IS DISTINCT FROM OLD.discount_millipercent
         OR NEW.surcharge_cents IS DISTINCT FROM OLD.surcharge_cents
         OR NEW.tax_rate_millipercent IS DISTINCT FROM OLD.tax_rate_millipercent
         OR NEW.deposit_cents IS DISTINCT FROM OLD.deposit_cents
         OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
         OR NEW.taxable_subtotal_cents IS DISTINCT FROM OLD.taxable_subtotal_cents
         OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
         OR NEW.taxable_after_discount_cents IS DISTINCT FROM OLD.taxable_after_discount_cents
         OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
         OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
         OR NEW.money_version IS DISTINCT FROM OLD.money_version
         OR NEW.document_template_version IS DISTINCT FROM OLD.document_template_version
         OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       )
    THEN
      RAISE EXCEPTION
        'Invoice % is issued and its content is frozen.', OLD.display_id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'An invoice cannot return to draft.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER invoices_terminal_state
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION enforce_invoice_terminal_state();

-- migrate:split

-- Line rows follow the parent: once the invoice leaves draft, its lines are
-- part of the frozen document.
CREATE OR REPLACE FUNCTION enforce_invoice_lines_locked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  parent_invoice uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
BEGIN
  SELECT status INTO parent_status FROM invoices WHERE id = parent_invoice;

  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Invoice lines cannot change once the invoice is %.', parent_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

-- migrate:split

CREATE TRIGGER invoice_line_items_locked
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_invoice_lines_locked();

-- migrate:split

CREATE TRIGGER invoice_events_append_only
  BEFORE UPDATE OR DELETE ON invoice_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE service_requests FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE service_request_photos ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE service_request_photos FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE job_events FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE job_materials ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE job_materials FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE inventory_transactions FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE invoice_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE invoice_events FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE receipts FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY service_requests_tenant_isolation ON service_requests
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY service_request_photos_tenant_isolation ON service_request_photos
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY jobs_tenant_isolation ON jobs
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY job_events_tenant_isolation ON job_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY job_materials_tenant_isolation ON job_materials
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY inventory_items_tenant_isolation ON inventory_items
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY inventory_transactions_tenant_isolation ON inventory_transactions
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY invoices_tenant_isolation ON invoices
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY invoice_line_items_tenant_isolation ON invoice_line_items
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY invoice_events_tenant_isolation ON invoice_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY receipts_tenant_isolation ON receipts
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON service_requests, service_request_photos, jobs, job_events, job_materials,
     inventory_items, inventory_transactions, invoices, invoice_line_items,
     invoice_events, receipts
  TO contractor_app;
