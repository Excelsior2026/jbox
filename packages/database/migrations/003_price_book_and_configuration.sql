-- 003_price_book_and_configuration.sql
--
-- The two reference datasets every commercial document draws from, under the
-- rules established in docs/architecture/foundation-decisions.md.
--
--   PRICE BOOK
--   An item's price is its version history (append-only). A release binds the
--   exact item versions in force at publish time; a published release is
--   immutable and is what a commercial document may draw from. Once estimates
--   gain a reference in migration 004, "unpublished pricing cannot enter a
--   commercial document" is enforced structurally, not by convention.
--
--   CONFIGURATION
--   One versioned, immutable document per tenant. The storefront and rendered
--   documents read the single approved version in force; approving a newer
--   version supersedes the old one. The document holds business facts and
--   branding only -- no approval-gated regulatory claims.

-- ---------------------------------------------------------------------------
-- Price book categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS price_book_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS price_book_categories_org_position_idx
  ON price_book_categories (organization_id, position, id);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Price book items
-- ---------------------------------------------------------------------------
-- Deliberately no price column: an item's price is the latest version in
-- price_book_item_versions, and editing the working price adds a version.

CREATE TABLE IF NOT EXISTS price_book_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  unit text NOT NULL DEFAULT 'ea' CHECK (unit ~ '^[a-z]{1,8}$'),
  taxable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (id, organization_id),
  FOREIGN KEY (category_id, organization_id)
    REFERENCES price_book_categories (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS price_book_items_org_category_idx
  ON price_book_items (organization_id, category_id, active);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Item price history (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS price_book_item_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version),
  UNIQUE (id, organization_id),
  FOREIGN KEY (item_id, organization_id)
    REFERENCES price_book_items (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS price_book_item_versions_item_idx
  ON price_book_item_versions (item_id, version DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Releases
-- ---------------------------------------------------------------------------
-- draft -> published. A published release is immutable and is the only pricing
-- a commercial document may reference. One open draft per organization keeps
-- "which pricing is next" unambiguous; history is the published releases.

CREATE TABLE IF NOT EXISTS price_book_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS price_book_releases_one_draft_idx
  ON price_book_releases (organization_id)
  WHERE status = 'draft';

-- migrate:split

-- The exact item version in force for each item in this release.
CREATE TABLE IF NOT EXISTS price_book_release_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  release_id uuid NOT NULL,
  item_id uuid NOT NULL,
  item_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, item_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (release_id, organization_id)
    REFERENCES price_book_releases (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id, organization_id)
    REFERENCES price_book_items (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (item_version_id, organization_id)
    REFERENCES price_book_item_versions (id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS price_book_release_items_version_idx
  ON price_book_release_items (item_version_id, organization_id);

-- migrate:split

-- A release becomes a record at publish. After that its membership is part of
-- the provenance of every estimate that drew from it.
CREATE OR REPLACE FUNCTION enforce_price_book_release_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' AND (
      NEW.status IS DISTINCT FROM 'published'
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR NEW.published_by IS DISTINCT FROM OLD.published_by
  ) THEN
    RAISE EXCEPTION 'Published price book release % is immutable.', OLD.name
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status = 'published' AND OLD.status <> 'published' THEN
    NEW.published_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER price_book_releases_terminal
  BEFORE UPDATE ON price_book_releases
  FOR EACH ROW
  EXECUTE FUNCTION enforce_price_book_release_terminal();

-- migrate:split

CREATE TRIGGER price_book_releases_no_delete
  BEFORE DELETE ON price_book_releases
  FOR EACH ROW
  WHEN (OLD.status = 'published')
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- Release membership is editable only while the release is still a draft.
CREATE OR REPLACE FUNCTION enforce_price_book_release_items_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release_status text;
BEGIN
  SELECT status INTO release_status
  FROM price_book_releases WHERE id = coalesce(NEW.release_id, OLD.release_id);

  IF release_status IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF release_status <> 'draft' THEN
    RAISE EXCEPTION 'Release items cannot change once the release is published.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

-- migrate:split

CREATE TRIGGER price_book_release_items_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON price_book_release_items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_price_book_release_items_draft();

-- migrate:split

CREATE TRIGGER price_book_item_versions_append_only
  BEFORE UPDATE OR DELETE ON price_book_item_versions
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ---------------------------------------------------------------------------
-- Tenant configuration (versioned, immutable)
-- ---------------------------------------------------------------------------
-- document_version names the shape of the jsonb document. Approving a draft
-- sets approved_at; approving a newer version supersedes the previous one. The
-- storefront and documents read the single approved, unsuperseded version.

CREATE TABLE IF NOT EXISTS configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved')),
  document_version text NOT NULL DEFAULT 'config-v1'
    CHECK (char_length(document_version) BETWEEN 1 AND 40),
  document jsonb NOT NULL
    CHECK (jsonb_typeof(document) = 'object'),
  created_by uuid,
  approved_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, version),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (status = 'approved' OR approved_at IS NULL)
);

-- migrate:split

-- At most one approved configuration in force per organization. "In force"
-- means approved and not superseded; the one permitted mutation to an approved
-- row is setting superseded_at when a newer version takes its place. That
-- transition is supersede-then-approve, done atomically by the application.
CREATE UNIQUE INDEX IF NOT EXISTS configuration_versions_one_in_force_idx
  ON configuration_versions (organization_id)
  WHERE status = 'approved' AND superseded_at IS NULL;

-- migrate:split

-- An approved configuration is a record. The only legal edit to one is marking
-- it superseded when a newer version is approved.
CREATE OR REPLACE FUNCTION enforce_configuration_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved' AND (
      NEW.status IS DISTINCT FROM 'approved'
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.document_version IS DISTINCT FROM OLD.document_version
      OR NEW.document IS DISTINCT FROM OLD.document
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'Approved configuration version % is immutable.', OLD.version
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status = 'approved' AND OLD.status = 'draft' THEN
    NEW.approved_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- migrate:split

CREATE TRIGGER configuration_versions_terminal
  BEFORE UPDATE ON configuration_versions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_configuration_terminal();

-- migrate:split

CREATE TRIGGER configuration_versions_no_delete
  BEFORE DELETE ON configuration_versions
  FOR EACH ROW
  WHEN (OLD.status = 'approved')
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE price_book_categories ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_categories FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_items ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_items FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_item_versions ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_item_versions FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_releases ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_releases FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_release_items ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE price_book_release_items FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE configuration_versions ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE configuration_versions FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY price_book_categories_tenant_isolation ON price_book_categories
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY price_book_items_tenant_isolation ON price_book_items
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY price_book_item_versions_tenant_isolation ON price_book_item_versions
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY price_book_releases_tenant_isolation ON price_book_releases
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY price_book_release_items_tenant_isolation ON price_book_release_items
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY configuration_versions_tenant_isolation ON configuration_versions
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON price_book_categories, price_book_items, price_book_item_versions,
     price_book_releases, price_book_release_items, configuration_versions
  TO contractor_app;
