-- isolation.sql
--
-- Proves the guarantees in docs/architecture/foundation-decisions.md against a
-- live database. Runs as the migration owner, which must hold contractor_app
-- and control_app (migration 001 grants both).
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f packages/database/checks/isolation.sql
--
-- Every assertion raises on failure, so a clean exit is the pass condition.
-- This is destructive: it provisions two throwaway organizations. Run it
-- against a disposable branch, never production.

\set ON_ERROR_STOP on

BEGIN;

-- --------------------------------------------------------------------------
-- Provisioning is a control-plane operation
-- --------------------------------------------------------------------------
SET LOCAL ROLE control_app;

INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'tenant-alpha', 'Alpha Electric', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'tenant-beta',  'Beta Electric',  'active');

INSERT INTO organization_domains (organization_id, hostname, is_canonical, verified, verified_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alpha.example.test', true, true,  now()),
  ('22222222-2222-2222-2222-222222222222', 'beta.example.test',  true, false, NULL);

RESET ROLE;

-- --------------------------------------------------------------------------
-- 1. A tenant sees only its own organization
-- --------------------------------------------------------------------------
DO $$
DECLARE
  visible int;
BEGIN
  PERFORM set_application_context(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT count(*) INTO visible FROM organizations;
  IF visible <> 1 THEN
    RAISE EXCEPTION 'Tenant alpha sees % organizations; expected exactly its own.', visible;
  END IF;

  SELECT count(*) INTO visible
  FROM organizations WHERE id = '22222222-2222-2222-2222-222222222222';
  IF visible <> 0 THEN
    RAISE EXCEPTION 'Tenant alpha can read tenant beta by id. Isolation is not holding.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Document numbering is per tenant, so two tenants never collide
-- --------------------------------------------------------------------------
DO $$
DECLARE
  alpha_first bigint;
  beta_first bigint;
BEGIN
  PERFORM set_application_context(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  alpha_first := allocate_document_number('estimate');
  RESET ROLE;

  PERFORM set_application_context(
    '22222222-2222-2222-2222-222222222222'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  beta_first := allocate_document_number('estimate');
  RESET ROLE;

  IF alpha_first <> 1 OR beta_first <> 1 THEN
    RAISE EXCEPTION
      'Expected each tenant to start estimate numbering at 1; got alpha=% beta=%.',
      alpha_first, beta_first;
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. A write with no tenant context raises rather than misfiling
-- --------------------------------------------------------------------------
-- This is the regression test for the predecessor's defining defect: a column
-- DEFAULT that coalesced missing context to a hardcoded organization, so an
-- unscoped insert produced a valid-looking row attributed to the wrong tenant.
-- Asserted against app_require_organization_id() DIRECTLY rather than through
-- a write. A write also fails without context -- but via an RLS policy
-- violation, which raises the same SQLSTATE 42501 (insufficient_privilege) as
-- the deliberate raise. Catching the code alone therefore passes whether or
-- not the fallback exists, which is a check that proves nothing. Verified: with
-- a coalesce fallback reintroduced, the write-based form still reported success
-- and this form fails as it should.
DO $$
DECLARE
  resolved uuid;
  raised boolean := false;
BEGIN
  PERFORM set_config('app.organization_id', '', true);
  BEGIN
    resolved := app_require_organization_id();
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION
      'app_require_organization_id() returned % with no context set. A fallback organization is present, and every unscoped write will be silently misattributed to it.',
      resolved;
  END IF;
END;
$$;

-- The write path must also refuse -- for its own reason (an RLS policy
-- violation), which is why this is a separate assertion from the one above.
DO $$
DECLARE
  raised boolean := false;
BEGIN
  PERFORM set_config('app.organization_id', '', true);
  SET LOCAL ROLE contractor_app;
  BEGIN
    PERFORM allocate_document_number('estimate');
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION 'A tenant-owned write succeeded with no organization context.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Hostname resolution is verified-only and fails closed
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF resolve_verified_organization('alpha.example.test')
     IS DISTINCT FROM '11111111-1111-1111-1111-111111111111'::uuid THEN
    RAISE EXCEPTION 'A verified hostname did not resolve to its organization.';
  END IF;

  IF resolve_verified_organization('beta.example.test') IS NOT NULL THEN
    RAISE EXCEPTION 'An UNVERIFIED hostname resolved. Resolution must fail closed.';
  END IF;

  IF resolve_verified_organization('unassigned.example.test') IS NOT NULL THEN
    RAISE EXCEPTION 'An unassigned hostname resolved.';
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Every RLS table is FORCEd, and no app role can opt out
-- --------------------------------------------------------------------------
DO $$
DECLARE
  unforced text;
  bypassing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO unforced
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relrowsecurity AND NOT c.relforcerowsecurity;
  IF unforced IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS enabled but not forced on: %. The table owner bypasses every policy there.', unforced;
  END IF;

  SELECT string_agg(rolname, ', ') INTO bypassing
  FROM pg_roles
  WHERE rolname IN ('contractor_app', 'control_app', 'platform_runtime')
    AND rolbypassrls;
  IF bypassing IS NOT NULL THEN
    RAISE EXCEPTION
      'Application role(s) hold BYPASSRLS: %. BYPASSRLS defeats FORCE.', bypassing;
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. No tenant-owned table permits a NULL organization_id
-- --------------------------------------------------------------------------
DO $$
DECLARE
  nullable text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO nullable
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
   AND a.attname = 'organization_id' AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT a.attnotnull;
  IF nullable IS NOT NULL THEN
    RAISE EXCEPTION 'organization_id is nullable on: %. Unattributed rows are possible.', nullable;
  END IF;
END;
$$;

ROLLBACK;

\echo 'isolation.sql: all checks passed'
