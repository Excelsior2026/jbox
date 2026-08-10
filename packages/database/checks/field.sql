-- field.sql
--
-- Exercises the Field suite from migration 004: service requests, jobs,
-- invoices, receipts, inventory, and -- the rule this migration exists to make
-- structural -- that a line item may only reference price book versions that
-- are in a PUBLISHED release. Destructive: provisions throwaway organizations,
-- then rolls back.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f packages/database/checks/field.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE control_app;
INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'field-alpha', 'Alpha Electric', 'active'),
  ('ffffffff-0000-0000-0000-000000000002', 'field-beta',  'Beta Electric',  'active');
RESET ROLE;

-- --------------------------------------------------------------------------
-- 1. Service request inbox: a request arrives with no customer, is accepted,
--    and can be converted to a customer
-- --------------------------------------------------------------------------
DO $$
DECLARE
  request uuid;
  customer uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('eeeeeeee-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO service_requests
    (document_number, display_id, contact_name, contact_email, summary)
  VALUES
    (allocate_document_number('service_request'), 'PE-SRQ-0001', 'A. Homeowner', 'a@example.test', 'No power to garage')
    RETURNING id INTO request;

  -- Accepting requires evidence, like signing an estimate.
  BEGIN
    UPDATE service_requests SET status = 'accepted' WHERE id = request;
    raised := false;
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A service request reached accepted without handled_at/handled_by.';
  END IF;

  INSERT INTO customers (document_number, display_id, display_name)
    VALUES (allocate_document_number('customer'), 'PE-CUS-0001', 'A. Homeowner')
    RETURNING id INTO customer;

  UPDATE service_requests
  SET status = 'accepted', handled_at = now(), handled_by = gen_random_uuid(), customer_id = customer
  WHERE id = request;

  INSERT INTO service_request_photos
    (service_request_id, storage_key, filename, content_type, size_bytes)
  VALUES (request, 'photos/' || request::text || '/1.jpg', 'garage.jpg', 'image/jpeg', 102400);

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Price provenance: draft pricing cannot enter a document; published can
-- --------------------------------------------------------------------------
DO $$
DECLARE
  category uuid;
  item uuid;
  version uuid;
  customer uuid;
  estimate uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('eeeeeeee-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO price_book_categories (name) VALUES ('Electrical') RETURNING id INTO category;
  INSERT INTO price_book_items (category_id, code, description)
    VALUES (category, 'PANEL-100', '200A panel upgrade') RETURNING id INTO item;
  INSERT INTO price_book_item_versions (item_id, version, unit_price_cents)
    VALUES (item, 1, 450000) RETURNING id INTO version;

  SELECT id INTO customer FROM customers WHERE display_id = 'PE-CUS-0001';
  INSERT INTO estimates (document_number, display_id, customer_id, title)
    VALUES (allocate_document_number('estimate'), 'PE-EST-0001', customer, 'Panel upgrade')
    RETURNING id INTO estimate;

  -- An ad-hoc line (no version reference) is fine.
  INSERT INTO estimate_line_items
    (estimate_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents)
  VALUES (estimate, 0, 'Trip charge', 100, 8500, 8500);

  -- A version that exists only as a draft price is structurally unreachable.
  BEGIN
    INSERT INTO estimate_line_items
      (estimate_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents, item_version_id)
    VALUES (estimate, 1, 'Panel', 100, 450000, 450000, version);
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A line referenced an unpublished price book version.';
  END IF;

  -- Publish a release binding that version, and the same line becomes legal.
  INSERT INTO price_book_releases (name) VALUES ('Release 1');
  INSERT INTO price_book_release_items (release_id, item_id, item_version_id)
    SELECT release.id, item, version FROM price_book_releases AS release WHERE release.status = 'draft';
  UPDATE price_book_releases SET status = 'published' WHERE status = 'draft';

  INSERT INTO estimate_line_items
    (estimate_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents, item_version_id)
  VALUES (estimate, 1, 'Panel', 100, 450000, 450000, version);

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Invoice lifecycle: issue freezes, paid settles, both are terminal
-- --------------------------------------------------------------------------
DO $$
DECLARE
  invoice uuid;
  customer uuid;
  version uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('eeeeeeee-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT id INTO customer FROM customers WHERE display_id = 'PE-CUS-0001';
  SELECT id INTO version FROM price_book_item_versions ORDER BY id LIMIT 1;

  INSERT INTO invoices (document_number, display_id, customer_id, title)
    VALUES (allocate_document_number('invoice'), 'PE-INV-0001', customer, 'Panel upgrade')
    RETURNING id INTO invoice;

  INSERT INTO invoice_line_items
    (invoice_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents, item_version_id)
  VALUES (invoice, 0, 'Panel', 100, 450000, 450000, version);

  -- Issue: freezes the content a customer was asked to pay.
  UPDATE invoices
  SET status = 'issued', issued_at = now(), content_hash = repeat('b', 64)
  WHERE id = invoice;

  BEGIN
    UPDATE invoices SET title = 'Edited after issue' WHERE id = invoice;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'An issued invoice was edited. Issued invoices must be frozen.';
  END IF;

  BEGIN
    INSERT INTO invoice_line_items
      (invoice_id, position, description, quantity_hundredths, unit_price_cents, line_total_cents)
    VALUES (invoice, 1, 'Added after issue', 100, 100, 100);
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A line was added to an issued invoice.';
  END IF;

  UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = invoice;

  BEGIN
    UPDATE invoices SET title = 'Edited after payment' WHERE id = invoice;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A paid invoice was edited. Paid invoices are terminal.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Receipts are created issued and immutable
-- --------------------------------------------------------------------------
DO $$
DECLARE
  invoice uuid;
  receipt uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('eeeeeeee-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT id INTO invoice FROM invoices WHERE display_id = 'PE-INV-0001';
  INSERT INTO receipts (document_number, display_id, invoice_id, amount_cents, method)
    VALUES (allocate_document_number('receipt'), 'PE-RCT-0001', invoice, 450000, 'card')
    RETURNING id INTO receipt;

  BEGIN
    UPDATE receipts SET notes = 'Edited' WHERE id = receipt;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A receipt was edited. Receipts are append-only.';
  END IF;

  BEGIN
    DELETE FROM receipts WHERE id = receipt;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A receipt was deleted.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Jobs reference a signed estimate; job events are append-only
-- --------------------------------------------------------------------------
DO $$
DECLARE
  customer uuid;
  estimate uuid;
  job uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('eeeeeeee-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT id INTO customer FROM customers WHERE display_id = 'PE-CUS-0001';
  SELECT id INTO estimate FROM estimates WHERE display_id = 'PE-EST-0001';
  UPDATE estimates
  SET status = 'signed', content_hash = repeat('a', 64), signed_at = now(), signed_by_name = 'A. Homeowner'
  WHERE id = estimate;

  INSERT INTO jobs (document_number, display_id, customer_id, estimate_id, title)
    VALUES (allocate_document_number('job'), 'PE-JOB-0001', customer, estimate, 'Panel upgrade install')
    RETURNING id INTO job;

  INSERT INTO job_events (job_id, event) VALUES (job, 'created');

  BEGIN
    DELETE FROM job_events WHERE job_id = job;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Job events were deletable.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Inventory: quantity ledger is append-only
-- --------------------------------------------------------------------------
DO $$
DECLARE
  item uuid;
  job uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('eeeeeeee-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO inventory_items (code, description, quantity_hundredths)
    VALUES ('WIRE-12', '12 AWG copper, 250ft roll', 40000)
    RETURNING id INTO item;

  INSERT INTO inventory_transactions (inventory_item_id, delta_hundredths, reason)
    VALUES (item, 40000, 'initial');

  SELECT id INTO job FROM jobs WHERE display_id = 'PE-JOB-0001';
  INSERT INTO inventory_transactions (inventory_item_id, delta_hundredths, reason, job_id)
    VALUES (item, -5000, 'used_on_job', job);

  BEGIN
    UPDATE inventory_transactions SET delta_hundredths = 0 WHERE inventory_item_id = item;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'An inventory transaction was edited. The movement ledger must be append-only.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 7. Direct reads are tenant-scoped on every new table
-- --------------------------------------------------------------------------
DO $$
DECLARE
  seen int;
BEGIN
  PERFORM set_application_context('ffffffff-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT count(*) INTO seen FROM service_requests
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'service_requests not isolated.'; END IF;

  SELECT count(*) INTO seen FROM service_request_photos
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'service_request_photos not isolated.'; END IF;

  SELECT count(*) INTO seen FROM jobs
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'jobs not isolated.'; END IF;

  SELECT count(*) INTO seen FROM job_events
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'job_events not isolated.'; END IF;

  SELECT count(*) INTO seen FROM job_materials
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'job_materials not isolated.'; END IF;

  SELECT count(*) INTO seen FROM inventory_items
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'inventory_items not isolated.'; END IF;

  SELECT count(*) INTO seen FROM inventory_transactions
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'inventory_transactions not isolated.'; END IF;

  SELECT count(*) INTO seen FROM invoices
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'invoices not isolated.'; END IF;

  SELECT count(*) INTO seen FROM invoice_line_items
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'invoice_line_items not isolated.'; END IF;

  SELECT count(*) INTO seen FROM invoice_events
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'invoice_events not isolated.'; END IF;

  SELECT count(*) INTO seen FROM receipts
    WHERE organization_id = 'eeeeeeee-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'receipts not isolated.'; END IF;

  RESET ROLE;
END;
$$;

ROLLBACK;

\echo 'field.sql: all checks passed'
