-- documents.sql
--
-- Exercises the document identity model from migration 002 against a live
-- database. Destructive: provisions throwaway organizations, then rolls back.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f packages/database/checks/documents.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE control_app;
INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'doc-alpha', 'Alpha Electric', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'doc-beta',  'Beta Electric',  'active');
RESET ROLE;

-- --------------------------------------------------------------------------
-- 1. Two tenants may hold the SAME display id
-- --------------------------------------------------------------------------
-- The predecessor's blocker in one assertion. There, document ids were a
-- global text primary key with '^PE-' in a CHECK constraint, so tenant #2
-- either failed the CHECK with its own prefix or collided on the primary key
-- reusing tenant #1's. Here display_id is unique per organization and nothing
-- joins on it, so both tenants issue 'PE-EST-0001' and neither is disturbed.
DO $$
DECLARE
  alpha_estimate uuid;
  beta_estimate uuid;
BEGIN
  PERFORM set_application_context('aaaaaaaa-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  INSERT INTO customers (document_number, display_id, display_name)
    VALUES (allocate_document_number('customer'), 'PE-CUS-0001', 'Alpha Homeowner');
  INSERT INTO estimates (document_number, display_id, customer_id, title)
    SELECT allocate_document_number('estimate'), 'PE-EST-0001', id, 'Panel upgrade'
    FROM customers WHERE display_id = 'PE-CUS-0001'
    RETURNING id INTO alpha_estimate;
  RESET ROLE;

  PERFORM set_application_context('bbbbbbbb-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  INSERT INTO customers (document_number, display_id, display_name)
    VALUES (allocate_document_number('customer'), 'PE-CUS-0001', 'Beta Homeowner');
  INSERT INTO estimates (document_number, display_id, customer_id, title)
    SELECT allocate_document_number('estimate'), 'PE-EST-0001', id, 'Service call'
    FROM customers WHERE display_id = 'PE-CUS-0001'
    RETURNING id INTO beta_estimate;
  RESET ROLE;

  IF alpha_estimate IS NULL OR beta_estimate IS NULL OR alpha_estimate = beta_estimate THEN
    RAISE EXCEPTION 'Two tenants could not independently issue PE-EST-0001.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. An estimate cannot reference another tenant's customer
-- --------------------------------------------------------------------------
-- The composite foreign key (customer_id, organization_id) is what makes this
-- structurally impossible rather than merely unlikely. A plain FK on
-- customer_id alone would permit it whenever the attacker knows a uuid.
DO $$
DECLARE
  foreign_customer uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('bbbbbbbb-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SELECT id INTO foreign_customer
  FROM customers WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  SET LOCAL ROLE contractor_app;
  BEGIN
    INSERT INTO estimates (document_number, display_id, customer_id, title)
    VALUES (allocate_document_number('estimate'), 'PE-EST-0002', foreign_customer, 'Cross-tenant');
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION 'An estimate referenced a customer belonging to another organization.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. A signed estimate is frozen
-- --------------------------------------------------------------------------
DO $$
DECLARE
  target uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('aaaaaaaa-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT id INTO target FROM estimates WHERE display_id = 'PE-EST-0001';

  UPDATE estimates
  SET status = 'signed',
      content_hash = repeat('a', 64),
      signed_at = now(),
      signed_by_name = 'A. Homeowner'
  WHERE id = target;

  BEGIN
    UPDATE estimates SET title = 'Edited after signing' WHERE id = target;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION 'A signed estimate was modified. Signed documents must be immutable.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Signing without evidence is rejected
-- --------------------------------------------------------------------------
DO $$
DECLARE
  target uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('bbbbbbbb-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT id INTO target FROM estimates WHERE display_id = 'PE-EST-0001';

  BEGIN
    UPDATE estimates SET status = 'signed' WHERE id = target;
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION 'An estimate reached signed status with no content hash, timestamp, or signer.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Lines of a signed estimate cannot change
-- --------------------------------------------------------------------------
DO $$
DECLARE
  target uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('aaaaaaaa-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT id INTO target FROM estimates WHERE display_id = 'PE-EST-0001';

  BEGIN
    INSERT INTO estimate_line_items
      (estimate_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents)
    VALUES (target, 0, 'Added after signing', 100, 5000, 5000);
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION 'A line item was added to a signed estimate.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. The audit trail is append-only
-- --------------------------------------------------------------------------
DO $$
DECLARE
  target uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('bbbbbbbb-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT id INTO target FROM estimates WHERE display_id = 'PE-EST-0001';
  INSERT INTO estimate_events (estimate_id, event) VALUES (target, 'created');

  BEGIN
    DELETE FROM estimate_events WHERE estimate_id = target;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION 'Audit events were deletable. An audit trail that can be rewritten is not one.';
  END IF;
END;
$$;

ROLLBACK;

\echo 'documents.sql: all checks passed'
