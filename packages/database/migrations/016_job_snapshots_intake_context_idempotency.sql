-- 016_job_snapshots_intake_context_idempotency.sql
--
-- Phase 1: Architecture & Data Integrity
--
-- 1. APPEND-ONLY JOB SNAPSHOTS
--    Maintains immutable snapshot records of job state at key lifecycle points
--    (initial request, approved estimate, change orders, final invoice) to
--    preserve the legal paper trail.
--
-- 2. CUSTOMER INTAKE CONTEXT SEPARATION
--    Separates "Customer's Stated Problem" from "Technician's Actual Diagnosis"
--    so the original context of the call is never overwritten or lost.
--
-- 3. IDEMPOTENCY KEYS FOR PAYMENTS
--    Supports unique cryptographic tokens for payment processing attempts to
--    prevent double-charging during weak network connections.

-- ---------------------------------------------------------------------------
-- 1. Job snapshots (append-only ledger)
-- ---------------------------------------------------------------------------
-- Immutable records of job state at key lifecycle points. Each snapshot
-- captures the complete state of the job at that moment, creating an
-- auditable trail that cannot be modified after creation.

CREATE TABLE IF NOT EXISTS job_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  
  -- Snapshot classification
  snapshot_type text NOT NULL
    CHECK (snapshot_type IN ('initial_request', 'approved_estimate', 'change_order', 'final_invoice', 'status_change')),
  
  -- Reference to the document that triggered this snapshot
  reference_document_type text
    CHECK (reference_document_type IS NULL OR reference_document_type IN ('estimate', 'invoice', 'change_order')),
  reference_document_id uuid,
  
  -- Immutable snapshot of job state at this point
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  status text NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  
  -- Customer intake context (immutable from initial request)
  customer_stated_problem text NOT NULL DEFAULT '' CHECK (char_length(customer_stated_problem) <= 4000),
  technician_diagnosis text NOT NULL DEFAULT '' CHECK (char_length(technician_diagnosis) <= 4000),
  
  -- Financial snapshot
  estimated_amount_cents bigint CHECK (estimated_amount_cents >= 0),
  final_amount_cents bigint CHECK (final_amount_cents >= 0),
  
  -- Line items snapshot (JSONB array of estimate/invoice line items)
  line_items_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(line_items_snapshot) = 'array'),
  
  -- Snapshot metadata
  snapshot_reason text NOT NULL DEFAULT '' CHECK (char_length(snapshot_reason) <= 500),
  actor_id uuid,
  
  -- Content hash for integrity verification
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (job_id, organization_id)
    REFERENCES jobs (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS job_snapshots_job_created_idx
  ON job_snapshots (job_id, created_at DESC, id DESC);

-- migrate:split

CREATE INDEX IF NOT EXISTS job_snapshots_org_type_idx
  ON job_snapshots (organization_id, snapshot_type, created_at DESC);

-- migrate:split

-- Append-only enforcement
CREATE TRIGGER job_snapshots_append_only
  BEFORE UPDATE OR DELETE ON job_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- 2. Customer intake context separation
-- ---------------------------------------------------------------------------
-- Separates the "Customer's Stated Problem" from the "Technician's Actual
-- Diagnosis" so the original context of the call is never overwritten or lost.
-- These fields are added to the jobs table to preserve the intake context.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS customer_stated_problem text NOT NULL DEFAULT ''
    CHECK (char_length(customer_stated_problem) <= 4000);

-- migrate:split

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS technician_diagnosis text NOT NULL DEFAULT ''
    CHECK (char_length(technician_diagnosis) <= 4000);

-- ---------------------------------------------------------------------------
-- 3. Idempotency keys for payments
-- ---------------------------------------------------------------------------
-- Supports unique cryptographic tokens for payment processing attempts to
-- prevent double-charging during weak network connections.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  
  -- The idempotency key (cryptographic token)
  key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  
  -- What this payment is for
  document_type text NOT NULL CHECK (document_type IN ('invoice', 'estimate', 'deposit')),
  document_id uuid NOT NULL,
  
  -- Payment details
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (char_length(currency) = 3),
  
  -- Processing state
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  
  -- Stripe integration
  stripe_payment_intent_id text
    CHECK (stripe_payment_intent_id IS NULL OR char_length(stripe_payment_intent_id) BETWEEN 1 AND 200),
  stripe_payment_method_id text
    CHECK (stripe_payment_method_id IS NULL OR char_length(stripe_payment_method_id) BETWEEN 1 AND 200),
  
  -- Result tracking
  processed_at timestamptz,
  failed_at timestamptz,
  failure_reason text CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 500),
  
  -- Metadata
  actor_id uuid,
  request_ip text CHECK (request_ip IS NULL OR char_length(request_ip) <= 45),
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  UNIQUE (organization_id, key_hash),
  
  CHECK (status <> 'completed' OR processed_at IS NOT NULL),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL),
  CHECK (status = 'completed' OR processed_at IS NULL),
  CHECK (status = 'failed' OR failed_at IS NULL)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS idempotency_keys_document_idx
  ON idempotency_keys (document_type, document_id, status, created_at DESC);

-- migrate:split

CREATE INDEX IF NOT EXISTS idempotency_keys_status_idx
  ON idempotency_keys (status, created_at)
  WHERE status IN ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- 4. Update job_events to include snapshot events
-- ---------------------------------------------------------------------------

ALTER TABLE job_events
  DROP CONSTRAINT job_events_event_check,
  ADD CONSTRAINT job_events_event_check
    CHECK (event IN
      ('created', 'status_changed', 'scheduled', 'note_added', 'materials_added',
       'completed', 'cancelled', 'estimate_linked', 'snapshot_created',
       'intake_context_updated', 'diagnosis_updated'));

-- ---------------------------------------------------------------------------
-- 5. Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE job_snapshots ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE job_snapshots FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY job_snapshots_tenant_isolation ON job_snapshots
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY idempotency_keys_tenant_isolation ON idempotency_keys
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

-- platform_runtime needs read access for payment webhook processing
CREATE POLICY idempotency_keys_platform_reads ON idempotency_keys
  FOR SELECT TO platform_runtime
  USING (true);

-- migrate:split

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON job_snapshots, idempotency_keys
  TO contractor_app;

-- migrate:split

GRANT SELECT
  ON idempotency_keys
  TO platform_runtime;

-- migrate:split

-- Function to create a job snapshot atomically
CREATE OR REPLACE FUNCTION create_job_snapshot(
  p_job_id uuid,
  p_snapshot_type text,
  p_reference_document_type text,
  p_reference_document_id uuid,
  p_snapshot_reason text,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot_id uuid;
  v_job_record RECORD;
  v_line_items jsonb;
BEGIN
  -- Get current job state
  SELECT * INTO v_job_record
  FROM jobs
  WHERE id = p_job_id
    AND organization_id = app_require_organization_id();
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % not found.', p_job_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  
  -- Get line items from the linked estimate or invoice
  IF p_reference_document_type = 'estimate' AND p_reference_document_id IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'description', eli.description,
          'quantity', eli.quantity_hundredths,
          'unit_price', eli.unit_price_cents,
          'total', eli.line_total_cents
        )
      ),
      '[]'::jsonb
    ) INTO v_line_items
    FROM estimate_line_items eli
    WHERE eli.estimate_id = p_reference_document_id
      AND eli.organization_id = app_require_organization_id();
  ELSIF p_reference_document_type = 'invoice' AND p_reference_document_id IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'description', ili.description,
          'quantity', ili.quantity_hundredths,
          'unit_price', ili.unit_price_cents,
          'total', ili.line_total_cents
        )
      ),
      '[]'::jsonb
    ) INTO v_line_items
    FROM invoice_line_items ili
    WHERE ili.invoice_id = p_reference_document_id
      AND ili.organization_id = app_require_organization_id();
  ELSE
    v_line_items := '[]'::jsonb;
  END IF;
  
  -- Create the snapshot
  INSERT INTO job_snapshots (
    organization_id, job_id, snapshot_type,
    reference_document_type, reference_document_id,
    title, status, customer_stated_problem, technician_diagnosis,
    line_items_snapshot, snapshot_reason, actor_id
  ) VALUES (
    app_require_organization_id(), p_job_id, p_snapshot_type,
    p_reference_document_type, p_reference_document_id,
    v_job_record.title, v_job_record.status,
    v_job_record.customer_stated_problem, v_job_record.technician_diagnosis,
    v_line_items, p_snapshot_reason, p_actor_id
  )
  RETURNING id INTO v_snapshot_id;
  
  -- Log the snapshot creation event
  INSERT INTO job_events (organization_id, job_id, event, actor_id, meta)
  VALUES (
    app_require_organization_id(), p_job_id, 'snapshot_created', p_actor_id,
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'snapshot_type', p_snapshot_type,
      'reference_document_type', p_reference_document_type,
      'reference_document_id', p_reference_document_id
    )
  );
  
  RETURN v_snapshot_id;
END;
$$;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  create_job_snapshot(uuid, text, text, uuid, text, uuid)
  TO contractor_app;
