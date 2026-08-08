-- 001_foundation.sql
--
-- Tenancy, roles, request context, and the isolation model everything else
-- sits on. See docs/architecture/foundation-decisions.md for the reasoning.
--
-- Three rules this migration establishes and every later migration must keep:
--
--   1. A tenant-owned table has organization_id NOT NULL whose DEFAULT raises
--      when no request context is set. There is no fallback organization.
--   2. RLS is ENABLEd and FORCEd together, in the migration that creates the
--      table. Never one without the other.
--   3. The runtime never owns a table and never connects as a BYPASSRLS role.
--      It assumes contractor_app, platform_runtime, or control_app per
--      transaction.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- All NOLOGIN: these are SET LOCAL ROLE targets, not credentials, so they
-- carry no secret and belong in version control. The restricted LOGIN role the
-- application authenticates as is created out of band and documented in the
-- deployment runbook.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contractor_app') THEN
    CREATE ROLE contractor_app
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;

-- migrate:split

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'control_app') THEN
    CREATE ROLE control_app
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;

-- migrate:split

-- platform_runtime serves the paths that arrive with no Host header and
-- therefore no tenant: provider webhooks, the outbox drain, health.
--
-- It holds NO BYPASSRLS, deliberately. Cross-tenant reach is granted one
-- narrow SECURITY DEFINER function at a time (resolve_verified_organization is
-- the first), and each such function is a reviewable window rather than a
-- blanket exemption. A webhook resolves its organization through one of those
-- windows and then does its per-tenant writes inside normal tenant context.
--
-- Two things fall out of this that are worth keeping:
--   - Postgres only lets a BYPASSRLS role create another BYPASSRLS role. A
--     blanket-bypass design therefore forces the migration owner to hold
--     BYPASSRLS too, which is how the predecessor ended up running migrations
--     as a role exempt from the isolation it was creating.
--   - Without it, this schema applies on stock PostgreSQL with an ordinary
--     non-superuser owner. Nothing depends on a provider's role attributes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_runtime') THEN
    CREATE ROLE platform_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;

-- migrate:split

DO $$
BEGIN
  EXECUTE format('GRANT contractor_app, control_app, platform_runtime TO %I', current_user);
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Request context
-- ---------------------------------------------------------------------------
-- Set per transaction by the application. The `true` second argument to
-- current_setting is "missing_ok": it yields NULL rather than raising when the
-- setting is absent. That is correct HERE, where callers must be able to ask
-- "is there a tenant?" -- and catastrophic when wrapped in a coalesce to some
-- default tenant, which is how the predecessor silently misfiled writes.

CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION app_current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid;
$$;

-- migrate:split

-- The column DEFAULT for every tenant-owned table. Raises rather than
-- substituting a fallback, so a write that forgets to enter tenant context
-- fails loudly at insert time instead of producing a plausible-looking row
-- attributed to the wrong tenant.
CREATE OR REPLACE FUNCTION app_require_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  resolved uuid := app_current_organization_id();
BEGIN
  IF resolved IS NULL THEN
    RAISE EXCEPTION 'Organization context is required for tenant-owned writes.'
      USING
        HINT = 'Wrap this operation in the scoped database client so app.organization_id is set for the transaction.',
        ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN resolved;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION set_application_context(
  organization_id uuid,
  actor_id uuid,
  request_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.organization_id', coalesce(organization_id::text, ''), true);
  PERFORM set_config('app.actor_id', coalesce(actor_id::text, ''), true);
  PERFORM set_config('app.request_id', coalesce(request_id::text, ''), true);
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
  display_name text NOT NULL
    CHECK (char_length(display_name) BETWEEN 2 AND 200),
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:split

-- Hostname is the tenant boundary for the product plane. `verified` gates
-- resolution: an unverified hostname never resolves, so a mistyped or
-- squatted domain cannot serve a tenant's data.
CREATE TABLE IF NOT EXISTS organization_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  hostname text NOT NULL UNIQUE
    CHECK (hostname = lower(hostname) AND char_length(hostname) BETWEEN 3 AND 253),
  is_canonical boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verified = false OR verified_at IS NOT NULL)
);

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_one_canonical_idx
  ON organization_domains (organization_id)
  WHERE is_canonical;

-- migrate:split

-- SECURITY DEFINER because hostname resolution necessarily runs BEFORE a
-- tenant is known -- it is what determines the tenant. Deliberately narrow:
-- takes a hostname, returns at most one organization id, and exposes nothing
-- else. search_path is pinned so the definer's rights cannot be redirected.
CREATE OR REPLACE FUNCTION resolve_verified_organization(candidate_hostname text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT domain.organization_id
  FROM organization_domains AS domain
  JOIN organizations AS organization
    ON organization.id = domain.organization_id
  WHERE domain.hostname = lower(candidate_hostname)
    AND domain.verified
    AND organization.status = 'active'
  LIMIT 1;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Per-tenant document numbering
-- ---------------------------------------------------------------------------
-- Decision 1: documents key on a surrogate uuid, number per tenant, and freeze
-- a display id. This table allocates the number. Two tenants may both display
-- "PE-EST-0042" and nothing collides, because uniqueness is scoped to the
-- organization and nothing joins on the display value.

CREATE TABLE IF NOT EXISTS organization_record_counters (
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  record_kind text NOT NULL
    CHECK (record_kind IN ('customer', 'estimate', 'job', 'invoice', 'receipt', 'purchase_order')),
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, record_kind)
);

-- migrate:split

-- Allocates and returns the next number for the CURRENT tenant. Row-locks
-- rather than using a sequence: sequence values are global and gapless-per-
-- sequence, which would either leak cross-tenant volume or require one
-- sequence per tenant per kind.
CREATE OR REPLACE FUNCTION allocate_document_number(kind text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  organization uuid := app_require_organization_id();
  allocated bigint;
BEGIN
  INSERT INTO organization_record_counters (organization_id, record_kind, next_value)
  VALUES (organization, kind, 1)
  ON CONFLICT (organization_id, record_kind) DO NOTHING;

  UPDATE organization_record_counters
  SET next_value = next_value + 1,
      updated_at = now()
  WHERE organization_id = organization
    AND record_kind = kind
  RETURNING next_value - 1 INTO allocated;

  IF allocated IS NULL THEN
    RAISE EXCEPTION 'Could not allocate a % number for organization %.', kind, organization
      USING ERRCODE = 'internal_error';
  END IF;

  RETURN allocated;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
-- ENABLE and FORCE together, always. ENABLE alone exempts the table owner,
-- which is the role migrations run as -- so the gap is invisible from exactly
-- the connection most likely to be testing it.

ALTER TABLE organization_domains ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE organization_domains FORCE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE organization_record_counters ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE organization_record_counters FORCE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- migrate:split

-- organizations and organization_domains are CONTROL-PLANE owned, not
-- tenant-owned. A tenant reads its own row; it never creates or modifies one.
--
-- Getting this wrong is self-demonstrating: a single tenant-scoped ALL policy
-- on organizations makes provisioning impossible, because creating the first
-- row would require already being in the context of the organization that row
-- defines. Policies are therefore split by role and by operation.

CREATE POLICY organizations_control_manages ON organizations
  FOR ALL TO control_app
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY organizations_tenant_reads_own ON organizations
  FOR SELECT TO contractor_app
  USING (id = app_current_organization_id());

-- migrate:split

-- Organization rows are platform metadata (id, slug, display name, status),
-- not customer data. The tenant-less paths need to map a provider identifier
-- onto an organization before any tenant context exists, so they get read
-- access here and nothing more -- no INSERT, UPDATE, or DELETE policy exists
-- for this role.
CREATE POLICY organizations_platform_reads ON organizations
  FOR SELECT TO platform_runtime
  USING (true);

-- migrate:split

CREATE POLICY organization_domains_control_manages ON organization_domains
  FOR ALL TO control_app
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY organization_domains_tenant_reads_own ON organization_domains
  FOR SELECT TO contractor_app
  USING (organization_id = app_current_organization_id());

-- migrate:split

-- Counters are genuinely tenant-owned: the tenant allocates its own document
-- numbers and nobody else touches them.
CREATE POLICY organization_record_counters_tenant_isolation ON organization_record_counters
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO contractor_app, control_app, platform_runtime;

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON organizations, organization_domains, organization_record_counters
  TO contractor_app, platform_runtime;

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON organizations, organization_domains
  TO control_app;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  app_current_organization_id(),
  app_current_actor_id(),
  app_require_organization_id(),
  resolve_verified_organization(text),
  allocate_document_number(text)
  TO contractor_app, control_app, platform_runtime;

-- migrate:split

-- set_application_context is what establishes the tenant boundary for a
-- transaction. The runtime login calls it BEFORE switching role, so it is
-- granted to PUBLIC rather than to the app roles.
GRANT EXECUTE ON FUNCTION set_application_context(uuid, uuid, uuid) TO PUBLIC;
