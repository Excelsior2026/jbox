-- pricing.sql
--
-- Exercises the price book (categories, items, append-only versions, releases)
-- and the versioned tenant configuration from migration 003. Destructive:
-- provisions throwaway organizations, then rolls back.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f packages/database/checks/pricing.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE control_app;
INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'price-alpha', 'Alpha Electric', 'active'),
  ('dddddddd-0000-0000-0000-000000000002', 'price-beta',  'Beta Electric',  'active');
RESET ROLE;

-- --------------------------------------------------------------------------
-- 1. Versioning: the working price is the latest version, and history is
--    append-only
-- --------------------------------------------------------------------------
DO $$
DECLARE
  category uuid;
  item uuid;
  price bigint;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('cccccccc-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO price_book_categories (name) VALUES ('Electrical')
    RETURNING id INTO category;

  INSERT INTO price_book_items (category_id, code, description)
    VALUES (category, 'PANEL-100', '200A panel upgrade')
    RETURNING id INTO item;

  INSERT INTO price_book_item_versions (item_id, version, unit_price_cents)
    VALUES (item, 1, 450000);
  INSERT INTO price_book_item_versions (item_id, version, unit_price_cents)
    VALUES (item, 2, 475000);

  SELECT unit_price_cents INTO price
  FROM price_book_item_versions
  WHERE item_id = item
  ORDER BY version DESC LIMIT 1;

  IF price <> 475000 THEN
    RAISE EXCEPTION 'Working price is %, expected the latest version price 475000.', price;
  END IF;

  BEGIN
    UPDATE price_book_item_versions SET unit_price_cents = 1 WHERE item_id = item;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION 'A price version was edited. Price history must be append-only.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. At most one open draft release; publishing binds the versions in force,
--    and a published release is immutable
-- --------------------------------------------------------------------------
DO $$
DECLARE
  release_a uuid;
  release_b uuid;
  item uuid;
  item_version uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('cccccccc-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT id INTO item FROM price_book_items WHERE code = 'PANEL-100';
  SELECT id INTO item_version FROM price_book_item_versions WHERE item_id = item ORDER BY version DESC LIMIT 1;

  INSERT INTO price_book_releases (name) VALUES ('Release 1')
    RETURNING id INTO release_a;
  INSERT INTO price_book_release_items (release_id, item_id, item_version_id)
    VALUES (release_a, item, item_version);

  -- A second open draft is structurally impossible.
  BEGIN
    INSERT INTO price_book_releases (name) VALUES ('Release 2')
      RETURNING id INTO release_b;
    raised := false;
  EXCEPTION WHEN unique_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A second open draft release was created. At most one draft per organization.';
  END IF;

  UPDATE price_book_releases SET status = 'published' WHERE id = release_a;
  IF (SELECT published_at FROM price_book_releases WHERE id = release_a) IS NULL THEN
    RAISE EXCEPTION 'Publishing a release did not stamp published_at.';
  END IF;

  -- A published release is immutable.
  BEGIN
    UPDATE price_book_releases SET name = 'Rewritten' WHERE id = release_a;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A published release was edited. Published releases must be immutable.';
  END IF;

  -- Membership is frozen once published.
  BEGIN
    INSERT INTO price_book_release_items (release_id, item_id, item_version_id)
    VALUES (release_a, item, item_version);
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Release membership changed after publish.';
  END IF;

  BEGIN
    DELETE FROM price_book_releases WHERE id = release_a;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A published release was deleted.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. Configuration: approving freezes the document, and only one approved
--    version is in force at a time
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v1 uuid;
  v2 uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('cccccccc-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO configuration_versions (version, document)
    VALUES (1, jsonb_build_object('template_id', 'modern', 'colors', jsonb_build_array('#111827', '#2563eb')))
    RETURNING id INTO v1;
  UPDATE configuration_versions SET status = 'approved' WHERE id = v1;

  INSERT INTO configuration_versions (version, document)
    VALUES (2, jsonb_build_object('template_id', 'modern', 'colors', jsonb_build_array('#111827', '#f59e0b')))
    RETURNING id INTO v2;

  -- Approving v2 supersedes v1: the in-force index permits exactly one, so the
  -- transition is supersede-then-approve, done atomically by the application.
  UPDATE configuration_versions SET superseded_at = now() WHERE id = v1;
  UPDATE configuration_versions SET status = 'approved' WHERE id = v2;

  IF (SELECT count(*) FROM configuration_versions
      WHERE status = 'approved' AND superseded_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'More than one approved configuration in force.';
  END IF;

  -- An approved configuration is immutable.
  BEGIN
    UPDATE configuration_versions
    SET document = jsonb_build_object('template_id', 'rewritten') WHERE id = v2;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'An approved configuration was edited. Approved configurations must be immutable.';
  END IF;

  BEGIN
    DELETE FROM configuration_versions WHERE id = v2;
    raised := false;
  EXCEPTION WHEN integrity_constraint_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'An approved configuration was deleted.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Cross-tenant: an item cannot reference another tenant's category, and a
--    price-book release item cannot reference another tenant's item version
-- --------------------------------------------------------------------------
-- The foreign identifiers are read AS the owning tenant so they are genuine:
-- reading them through beta's lens would yield NULL and fail on NOT NULL, which
-- tests a different (weaker) thing than the composite FK.
DO $$
DECLARE
  foreign_category uuid;
  foreign_item uuid;
  foreign_version uuid;
  release uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('cccccccc-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  SELECT id INTO foreign_category
  FROM price_book_categories ORDER BY id LIMIT 1;
  SELECT id INTO foreign_item
  FROM price_book_items ORDER BY id LIMIT 1;
  SELECT id INTO foreign_version
  FROM price_book_item_versions ORDER BY id LIMIT 1;
  RESET ROLE;

  PERFORM set_application_context('dddddddd-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  INSERT INTO price_book_releases (name) VALUES ('Release 1') RETURNING id INTO release;

  BEGIN
    INSERT INTO price_book_items (category_id, code, description)
    VALUES (foreign_category, 'PANEL-200', 'Cross-tenant');
    raised := false;
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'An item referenced another tenant''s category.';
  END IF;

  BEGIN
    INSERT INTO price_book_release_items (release_id, item_id, item_version_id)
    VALUES (release, foreign_item, foreign_version);
    raised := false;
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A release referenced another tenant''s item version.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Direct reads are tenant-scoped on every price book and config table
-- --------------------------------------------------------------------------
-- Each table has its own FOR ALL policy; this catches a policy typo'd to the
-- wrong column or missing entirely, which the generic FORCE checks cannot see.
DO $$
DECLARE
  seen int;
BEGIN
  PERFORM set_application_context('dddddddd-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT count(*) INTO seen FROM price_book_categories
    WHERE organization_id = 'cccccccc-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'price_book_categories not isolated.'; END IF;

  SELECT count(*) INTO seen FROM price_book_items
    WHERE organization_id = 'cccccccc-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'price_book_items not isolated.'; END IF;

  SELECT count(*) INTO seen FROM price_book_item_versions
    WHERE organization_id = 'cccccccc-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'price_book_item_versions not isolated.'; END IF;

  SELECT count(*) INTO seen FROM price_book_releases
    WHERE organization_id = 'cccccccc-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'price_book_releases not isolated.'; END IF;

  SELECT count(*) INTO seen FROM price_book_release_items
    WHERE organization_id = 'cccccccc-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'price_book_release_items not isolated.'; END IF;

  SELECT count(*) INTO seen FROM configuration_versions
    WHERE organization_id = 'cccccccc-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'configuration_versions not isolated.'; END IF;

  RESET ROLE;
END;
$$;

ROLLBACK;

\echo 'pricing.sql: all checks passed'
