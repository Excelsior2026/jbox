-- Migration 017: Payment Idempotency, Complex Payment States, and Change Orders
-- Phase 2: Core Business Logic & Financials

-- ---------------------------------------------------------------------------
-- 1. Update invoice status to support partially_paid
-- ---------------------------------------------------------------------------

-- Drop the existing status CHECK constraint
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

-- Add the new CHECK constraint with partially_paid
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled'));

-- Add amount_paid_cents column for tracking partial payments
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS amount_paid_cents bigint NOT NULL DEFAULT 0
    CHECK (amount_paid_cents >= 0);

-- migrate:split

-- Update the invoice terminal state function to support partially_paid
CREATE OR REPLACE FUNCTION enforce_invoice_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cannot return to draft from any non-draft status
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'An invoice cannot return to draft';
  END IF;

  -- draft -> issued: freeze content
  IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
    IF NEW.issued_at IS NULL THEN
      RAISE EXCEPTION 'issued_at must be set when issuing an invoice';
    END IF;
    -- Freeze content columns
    NEW.title := OLD.title;
    NEW.notes := OLD.notes;
    NEW.discount_millipercent := OLD.discount_millipercent;
    NEW.surcharge_cents := OLD.surcharge_cents;
    NEW.tax_rate_millipercent := OLD.tax_rate_millipercent;
    NEW.deposit_cents := OLD.deposit_cents;
    NEW.subtotal_cents := OLD.subtotal_cents;
    NEW.taxable_subtotal_cents := OLD.taxable_subtotal_cents;
    NEW.discount_cents := OLD.discount_cents;
    NEW.taxable_after_discount_cents := OLD.taxable_after_discount_cents;
    NEW.tax_cents := OLD.tax_cents;
    NEW.total_cents := OLD.total_cents;
    NEW.money_version := OLD.money_version;
    NEW.content_hash := OLD.content_hash;
  END IF;

  -- issued -> partially_paid: track payment amount
  IF OLD.status = 'issued' AND NEW.status = 'partially_paid' THEN
    IF NEW.amount_paid_cents <= 0 THEN
      RAISE EXCEPTION 'amount_paid_cents must be > 0 for partial payment';
    END IF;
    IF NEW.amount_paid_cents >= NEW.total_cents THEN
      RAISE EXCEPTION 'Use paid status for full payment';
    END IF;
    -- Freeze content (same as issued)
    NEW.title := OLD.title;
    NEW.notes := OLD.notes;
    NEW.discount_millipercent := OLD.discount_millipercent;
    NEW.surcharge_cents := OLD.surcharge_cents;
    NEW.tax_rate_millipercent := OLD.tax_rate_millipercent;
    NEW.deposit_cents := OLD.deposit_cents;
    NEW.subtotal_cents := OLD.subtotal_cents;
    NEW.taxable_subtotal_cents := OLD.taxable_subtotal_cents;
    NEW.discount_cents := OLD.discount_cents;
    NEW.taxable_after_discount_cents := OLD.taxable_after_discount_cents;
    NEW.tax_cents := OLD.tax_cents;
    NEW.total_cents := OLD.total_cents;
    NEW.money_version := OLD.money_version;
    NEW.content_hash := OLD.content_hash;
  END IF;

  -- partially_paid -> partially_paid: update payment amount
  IF OLD.status = 'partially_paid' AND NEW.status = 'partially_paid' THEN
    IF NEW.amount_paid_cents <= 0 THEN
      RAISE EXCEPTION 'amount_paid_cents must be > 0';
    END IF;
    IF NEW.amount_paid_cents >= NEW.total_cents THEN
      RAISE EXCEPTION 'Use paid status for full payment';
    END IF;
    -- Content stays frozen
    NEW.title := OLD.title;
    NEW.notes := OLD.notes;
    NEW.discount_millipercent := OLD.discount_millipercent;
    NEW.surcharge_cents := OLD.surcharge_cents;
    NEW.tax_rate_millipercent := OLD.tax_rate_millipercent;
    NEW.deposit_cents := OLD.deposit_cents;
    NEW.subtotal_cents := OLD.subtotal_cents;
    NEW.taxable_subtotal_cents := OLD.taxable_subtotal_cents;
    NEW.discount_cents := OLD.discount_cents;
    NEW.taxable_after_discount_cents := OLD.taxable_after_discount_cents;
    NEW.tax_cents := OLD.tax_cents;
    NEW.total_cents := OLD.total_cents;
    NEW.money_version := OLD.money_version;
    NEW.content_hash := OLD.content_hash;
  END IF;

  -- issued OR partially_paid -> paid: final payment
  IF (OLD.status = 'issued' OR OLD.status = 'partially_paid') AND NEW.status = 'paid' THEN
    IF NEW.paid_at IS NULL THEN
      RAISE EXCEPTION 'paid_at must be set when marking invoice as paid';
    END IF;
    NEW.amount_paid_cents := NEW.total_cents;
    -- Freeze content
    NEW.title := OLD.title;
    NEW.notes := OLD.notes;
    NEW.discount_millipercent := OLD.discount_millipercent;
    NEW.surcharge_cents := OLD.surcharge_cents;
    NEW.tax_rate_millipercent := OLD.tax_rate_millipercent;
    NEW.deposit_cents := OLD.deposit_cents;
    NEW.subtotal_cents := OLD.subtotal_cents;
    NEW.taxable_subtotal_cents := OLD.taxable_subtotal_cents;
    NEW.discount_cents := OLD.discount_cents;
    NEW.taxable_after_discount_cents := OLD.taxable_after_discount_cents;
    NEW.tax_cents := OLD.tax_cents;
    NEW.total_cents := OLD.total_cents;
    NEW.money_version := OLD.money_version;
    NEW.content_hash := OLD.content_hash;
  END IF;

  -- issued OR partially_paid -> cancelled
  IF (OLD.status = 'issued' OR OLD.status = 'partially_paid') AND NEW.status = 'cancelled' THEN
    IF NEW.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'cancelled_at must be set when cancelling an invoice';
    END IF;
    -- Freeze content
    NEW.title := OLD.title;
    NEW.notes := OLD.notes;
    NEW.discount_millipercent := OLD.discount_millipercent;
    NEW.surcharge_cents := OLD.surcharge_cents;
    NEW.tax_rate_millipercent := OLD.tax_rate_millipercent;
    NEW.deposit_cents := OLD.deposit_cents;
    NEW.subtotal_cents := OLD.subtotal_cents;
    NEW.taxable_subtotal_cents := OLD.taxable_subtotal_cents;
    NEW.discount_cents := OLD.discount_cents;
    NEW.taxable_after_discount_cents := OLD.taxable_after_discount_cents;
    NEW.tax_cents := OLD.tax_cents;
    NEW.total_cents := OLD.total_cents;
    NEW.money_version := OLD.money_version;
    NEW.content_hash := OLD.content_hash;
  END IF;

  -- paid and cancelled are terminal
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'A paid invoice cannot be modified';
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled invoice cannot be modified';
  END IF;

  RETURN NEW;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 2. Add change_order to document number sequence
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ALTER TABLE organization_record_counters
    DROP CONSTRAINT IF EXISTS organization_record_counters_record_kind_check;
  ALTER TABLE organization_record_counters
    ADD CONSTRAINT organization_record_counters_record_kind_check
    CHECK (record_kind IN
      ('customer', 'estimate', 'service_request', 'job', 'invoice', 'receipt', 'purchase_order', 'change_order'));
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 3. Idempotency key validation functions
-- ---------------------------------------------------------------------------

-- Generate a cryptographic idempotency key for payment operations
CREATE OR REPLACE FUNCTION generate_payment_idempotency_key(
  p_document_type text,
  p_document_id uuid,
  p_amount_cents bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key_bytes bytea;
  v_key_hash text;
BEGIN
  -- Generate 32 random bytes for the idempotency key
  v_key_bytes := gen_random_bytes(32);
  
  -- Hash the key with SHA-256 for storage
  v_key_hash := encode(digest(v_key_bytes, 'sha256'), 'hex');
  
  -- Return the hex-encoded key (not the hash) for the caller to use
  RETURN encode(v_key_bytes, 'hex');
END;
$$;

-- migrate:split

-- Validate and consume an idempotency key
-- Returns the existing result if the key was already used, NULL otherwise
CREATE OR REPLACE FUNCTION validate_idempotency_key(
  p_key_hash text,
  p_document_type text,
  p_document_id uuid,
  p_amount_cents bigint,
  p_actor_id uuid DEFAULT NULL,
  p_request_ip text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  -- Check if this key already exists
  SELECT id INTO v_existing_id
  FROM idempotency_keys
  WHERE key_hash = p_key_hash
    AND organization_id = app_require_organization_id()
    AND document_type = p_document_type
    AND document_id = p_document_id
    AND amount_cents = p_amount_cents;
  
  -- If key exists and is completed, return the existing id
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;
  
  -- If key exists but is pending/processing, return NULL (let caller handle)
  IF v_existing_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  
  -- Insert new idempotency key
  v_new_id := gen_random_uuid();
  INSERT INTO idempotency_keys (
    id, organization_id, key_hash, document_type, document_id,
    amount_cents, status, actor_id, request_ip
  ) VALUES (
    v_new_id, app_require_organization_id(), p_key_hash,
    p_document_type, p_document_id, p_amount_cents,
    'pending', p_actor_id, p_request_ip
  );
  
  RETURN v_new_id;
END;
$$;

-- migrate:split

-- Mark an idempotency key as processing
CREATE OR REPLACE FUNCTION mark_idempotency_processing(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE idempotency_keys
  SET status = 'processing', updated_at = now()
  WHERE id = p_id
    AND organization_id = app_require_organization_id()
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Idempotency key % is not in pending state', p_id;
  END IF;
END;
$$;

-- migrate:split

-- Mark an idempotency key as completed
CREATE OR REPLACE FUNCTION mark_idempotency_completed(
  p_id uuid,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_stripe_payment_method_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE idempotency_keys
  SET status = 'completed',
      processed_at = now(),
      stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
      stripe_payment_method_id = COALESCE(p_stripe_payment_method_id, stripe_payment_method_id),
      updated_at = now()
  WHERE id = p_id
    AND organization_id = app_require_organization_id()
    AND status = 'processing';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Idempotency key % is not in processing state', p_id;
  END IF;
END;
$$;

-- migrate:split

-- Mark an idempotency key as failed
CREATE OR REPLACE FUNCTION mark_idempotency_failed(
  p_id uuid,
  p_failure_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE idempotency_keys
  SET status = 'failed',
      failed_at = now(),
      failure_reason = p_failure_reason,
      updated_at = now()
  WHERE id = p_id
    AND organization_id = app_require_organization_id()
    AND status IN ('pending', 'processing');
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Idempotency key % cannot be marked as failed', p_id;
  END IF;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 3. Change orders table
-- ---------------------------------------------------------------------------

-- Change orders track modifications to estimates after customer approval
CREATE TABLE IF NOT EXISTS change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  
  -- Reference to the original estimate
  estimate_id uuid NOT NULL
    REFERENCES estimates(id) ON DELETE RESTRICT,
  
  -- Reference to the job this change order applies to
  job_id uuid NOT NULL
    REFERENCES jobs(id) ON DELETE RESTRICT,
  
  -- Document identity
  document_number bigint NOT NULL,
  display_id text NOT NULL,
  
  -- Change order details
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  
  -- Financial impact
  original_total_cents bigint NOT NULL,
  change_amount_cents bigint NOT NULL,
  new_total_cents bigint NOT NULL,
  
  -- Status tracking
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
  
  -- Approval tracking
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),
  
  -- Metadata
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, document_number)
);

-- migrate:split

-- Change order line items (new/modified lines)
CREATE TABLE IF NOT EXISTS change_order_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  
  change_order_id uuid NOT NULL
    REFERENCES change_orders(id) ON DELETE CASCADE,
  
  -- Line item details
  position integer NOT NULL CHECK (position > 0),
  item_code text NOT NULL CHECK (char_length(item_code) BETWEEN 1 AND 40),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  item_version_id uuid,
  quantity_hundredths integer NOT NULL CHECK (quantity_hundredths > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  taxable boolean NOT NULL DEFAULT true,
  line_total_cents integer NOT NULL,
  
  -- What this line represents
  action text NOT NULL DEFAULT 'add'
    CHECK (action IN ('add', 'modify', 'remove')),
  
  -- Reference to original line if modifying/removing
  original_line_item_id uuid,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (id, organization_id),
  UNIQUE (change_order_id, position)
);

-- migrate:split

-- Change order events (audit trail)
CREATE TABLE IF NOT EXISTS change_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  
  change_order_id uuid NOT NULL
    REFERENCES change_orders(id) ON DELETE RESTRICT,
  
  event text NOT NULL,
  actor_id uuid,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (id, organization_id)
);

-- migrate:split

-- Indexes for change orders
CREATE INDEX IF NOT EXISTS change_orders_estimate_idx
  ON change_orders (estimate_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS change_orders_job_idx
  ON change_orders (job_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS change_order_lines_co_idx
  ON change_order_line_items (change_order_id, position);

CREATE INDEX IF NOT EXISTS change_order_events_co_idx
  ON change_order_events (change_order_id, created_at DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- 4. Isolation for new tables
-- ---------------------------------------------------------------------------

ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE change_orders FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE change_order_line_items ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE change_order_line_items FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE change_order_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE change_order_events FORCE ROW LEVEL SECURITY;

-- migrate:split

-- RLS policies for change orders
CREATE POLICY change_orders_tenant_isolation ON change_orders
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY change_order_line_items_tenant_isolation ON change_order_line_items
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY change_order_events_tenant_isolation ON change_order_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON change_orders, change_order_line_items, change_order_events
  TO contractor_app;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 6. Append-only enforcement for change order events
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_change_order_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Change order events are append-only';
END;
$$;

-- migrate:split

CREATE TRIGGER change_order_events_append_only
  BEFORE UPDATE OR DELETE ON change_order_events
  FOR EACH ROW EXECUTE FUNCTION reject_change_order_mutation();

-- migrate:split

-- ---------------------------------------------------------------------------
-- 7. Update estimate events to include change_order events
-- ---------------------------------------------------------------------------

ALTER TABLE estimate_events
  DROP CONSTRAINT estimate_events_event_check,
  ADD CONSTRAINT estimate_events_event_check
    CHECK (event IN
      ('created', 'updated', 'signed', 'declined', 'duplicated',
       'job_linked', 'invoice_created', 'change_order_created',
       'change_order_approved', 'change_order_rejected'));
