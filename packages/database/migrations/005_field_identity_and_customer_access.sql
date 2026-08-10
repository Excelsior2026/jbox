-- 005_field_identity_and_customer_access.sql
--
-- What the Field workspace needs beyond 001-004:
--
--   - IDENTITY   Staff sign in with Clerk. platform_users and
--                organization_memberships hold the mapping; clerk_webhook_events
--                is the idempotent log the sync is built on. Organizations gain
--                clerk_organization_id so a Clerk org maps onto an internal one.
--
--   - ACCESS     Customer documents are reached through expiring, revocable,
--                single-use signing links. customer_access_grants stores the
--                scoped grant; the link itself is a signed token derived from
--                CUSTOMER_LINK_SECRET and only its SHA-256 is stored.
--
--   - OUTBOX     Durable delivery. transactional_outbox is written in the same
--                transaction as the business row it announces, and drained by a
--                cross-tenant cron. Cross-tenant reach is one narrow SECURITY
--                DEFINER function at a time, per foundation-decisions.md.
--
-- Isolation model is unchanged: tenant tables get app_require_organization_id()
-- defaults, RLS ENABLE + FORCE, one FOR ALL policy scoped to the tenant for
-- contractor_app. platform_runtime never holds BYPASSRLS; identity sync and the
-- outbox drain are explicit SECURITY DEFINER windows.

-- ---------------------------------------------------------------------------
-- Organizations link to Clerk
-- ---------------------------------------------------------------------------

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS clerk_organization_id text
  CHECK (clerk_organization_id IS NULL OR char_length(clerk_organization_id) BETWEEN 1 AND 200);

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS organizations_clerk_organization_id_idx
  ON organizations (clerk_organization_id)
  WHERE clerk_organization_id IS NOT NULL;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Platform users (one per Clerk user, across all tenants)
-- ---------------------------------------------------------------------------
-- Platform-owned, like organizations: there is no single owning tenant. RLS
-- still applies; contractor_app reads only the users who are members of its
-- organization.

CREATE TABLE IF NOT EXISTS platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE
    CHECK (char_length(clerk_user_id) BETWEEN 1 AND 200),
  email text NOT NULL CHECK (char_length(email) BETWEEN 1 AND 320),
  display_name text NOT NULL DEFAULT 'Staff member'
    CHECK (char_length(display_name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  identity_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Organization memberships
-- ---------------------------------------------------------------------------
-- Tenant-owned. role is the J-Box application role, already mapped from the
-- Clerk organization role by the webhook handler; the mapping lives in the
-- application, not here.

CREATE TABLE IF NOT EXISTS organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  platform_user_id uuid NOT NULL,
  clerk_membership_id text NOT NULL UNIQUE
    CHECK (char_length(clerk_membership_id) BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('owner', 'office', 'technician')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  mfa_required boolean NOT NULL DEFAULT false,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, platform_user_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (platform_user_id)
    REFERENCES platform_users (id) ON DELETE RESTRICT,
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
  ON organization_memberships (platform_user_id, status);

-- migrate:split

CREATE INDEX IF NOT EXISTS organization_memberships_org_idx
  ON organization_memberships (organization_id, status);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Clerk webhook event log (platform-owned, idempotency ledger)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clerk_webhook_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
  organization_id uuid,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 200),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  entity_kind text NOT NULL
    CHECK (entity_kind IN ('user', 'organization', 'membership', 'other')),
  external_entity_id text NOT NULL CHECK (char_length(external_entity_id) BETWEEN 1 AND 200),
  processed_at timestamptz,
  processing_error_code text
    CHECK (processing_error_code IS NULL OR char_length(processing_error_code) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:split

CREATE INDEX IF NOT EXISTS clerk_webhook_events_entity_idx
  ON clerk_webhook_events (entity_kind, external_entity_id, occurred_at DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Customer access grants (signing / viewing links)
-- ---------------------------------------------------------------------------
-- One active grant per (document, purpose) keeps "which link is live" unambiguous;
-- sending a new link revokes nothing structurally but creating a second active
-- one requires revoking the first. The customer-facing routes resolve the tenant
-- from the Host header (withTenant) and then the grant by token_hash within that
-- tenant, so the token and the hostname must agree on the organization.

CREATE TABLE IF NOT EXISTS customer_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('estimate', 'invoice')),
  document_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'sign' CHECK (purpose IN ('sign', 'view')),
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  key_version text NOT NULL DEFAULT 'v1' CHECK (char_length(key_version) BETWEEN 1 AND 40),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'consumed')),
  expires_at timestamptz NOT NULL,
  created_by uuid,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id) ON DELETE RESTRICT,
  CHECK (status <> 'consumed' OR consumed_at IS NOT NULL),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CHECK (status = 'active' OR (consumed_at IS NOT NULL OR revoked_at IS NOT NULL))
);

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS customer_access_grants_one_active_idx
  ON customer_access_grants (document_type, document_id, purpose)
  WHERE status = 'active';

-- migrate:split

CREATE INDEX IF NOT EXISTS customer_access_grants_document_idx
  ON customer_access_grants (document_type, document_id, status, expires_at);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Transactional outbox
-- ---------------------------------------------------------------------------
-- Written in the same transaction as the row it announces. status lifecycle:
-- pending -> claimed -> sent | failed -> (retries) -> dead. claimed_until is
-- the lease on the claim: a claim that exceeds it (a crash mid-delivery) is
-- eligible again.

CREATE TABLE IF NOT EXISTS transactional_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  topic text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 100),
  key text NOT NULL DEFAULT '' CHECK (char_length(key) <= 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  claimed_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (status IN ('pending', 'failed') OR claimed_until IS NOT NULL OR status = 'dead' OR status = 'sent')
);

-- migrate:split

CREATE INDEX IF NOT EXISTS transactional_outbox_drain_idx
  ON transactional_outbox (status, next_attempt_at, id)
  WHERE status IN ('pending', 'failed');

-- migrate:split

-- ---------------------------------------------------------------------------
-- Estimates gain the customer-document columns
-- ---------------------------------------------------------------------------

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT ''
    CHECK (char_length(scope) <= 4000);

-- migrate:split

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS exclusions text NOT NULL DEFAULT ''
    CHECK (char_length(exclusions) <= 4000);

-- migrate:split

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS service_request_id uuid;

-- migrate:split

ALTER TABLE estimates
  ADD CONSTRAINT estimates_service_request_fk
  FOREIGN KEY (service_request_id, organization_id)
  REFERENCES service_requests (id, organization_id) ON DELETE SET NULL;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Identity sync windows (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- The Clerk webhook arrives with no Host header and therefore no tenant, so it
-- runs as platform_runtime with no context. These functions are the only places
-- that write identity rows from that position. Each is pinned to search_path and
-- narrow: a function that takes exactly the identifiers the webhook knows.

CREATE OR REPLACE FUNCTION upsert_platform_user(
  user_clerk_id text,
  user_email text,
  user_display_name text,
  user_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  user_id uuid;
BEGIN
  INSERT INTO platform_users (clerk_user_id, email, display_name, status, identity_deleted_at)
  VALUES (user_clerk_id, user_email, user_display_name, CASE WHEN user_active THEN 'active' ELSE 'suspended' END, NULL)
  ON CONFLICT (clerk_user_id)
  DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
    identity_deleted_at = NULL,
    updated_at = now()
  RETURNING id INTO user_id;

  RETURN user_id;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION deactivate_platform_user(user_clerk_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users
  SET status = 'suspended', identity_deleted_at = now(), updated_at = now()
  WHERE clerk_user_id = user_clerk_id;

  UPDATE organization_memberships AS membership
  SET status = 'revoked', revoked_at = coalesce(membership.revoked_at, now()), updated_at = now()
  FROM platform_users AS platform_user
  WHERE membership.platform_user_id = platform_user.id
    AND platform_user.clerk_user_id = user_clerk_id
    AND membership.status <> 'revoked';
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION link_organization_clerk(
  organization_uuid uuid,
  clerk_org_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organizations
  SET clerk_organization_id = clerk_org_id, updated_at = now()
  WHERE id = organization_uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization % is not provisioned.', organization_uuid
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION resolve_organization_by_clerk_id(clerk_org_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  organization_uuid uuid;
BEGIN
  SELECT id INTO organization_uuid
  FROM organizations
  WHERE clerk_organization_id = clerk_org_id;

  IF organization_uuid IS NULL THEN
    RAISE EXCEPTION 'Clerk organization % is not provisioned.', clerk_org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN organization_uuid;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION suspend_organization_by_clerk_id(clerk_org_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organizations
  SET status = 'suspended', updated_at = now()
  WHERE clerk_organization_id = clerk_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clerk organization % is not provisioned.', clerk_org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

-- migrate:split

-- Upserts the platform user and the membership together, resolving the
-- organization from its Clerk id. Raises if the organization is not provisioned,
-- so a membership event cannot invent a tenant.
CREATE OR REPLACE FUNCTION upsert_clerk_membership(
  clerk_org_id text,
  user_clerk_id text,
  user_email text,
  user_display_name text,
  membership_clerk_id text,
  membership_role text,
  membership_mfa_required boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  organization_uuid uuid;
  user_id uuid;
  membership_id uuid;
BEGIN
  organization_uuid := resolve_organization_by_clerk_id(clerk_org_id);
  user_id := upsert_platform_user(user_clerk_id, user_email, user_display_name, true);

  INSERT INTO organization_memberships (
    organization_id, platform_user_id, clerk_membership_id, role,
    status, mfa_required, accepted_at, revoked_at
  )
  VALUES (
    organization_uuid, user_id, membership_clerk_id, membership_role,
    'active', membership_mfa_required, now(), NULL
  )
  ON CONFLICT (organization_id, platform_user_id)
  DO UPDATE SET
    clerk_membership_id = EXCLUDED.clerk_membership_id,
    role = EXCLUDED.role,
    status = 'active',
    mfa_required = EXCLUDED.mfa_required,
    accepted_at = coalesce(organization_memberships.accepted_at, now()),
    revoked_at = NULL,
    updated_at = now()
  RETURNING id INTO membership_id;

  RETURN membership_id;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION revoke_clerk_membership(membership_clerk_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_memberships
  SET status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
  WHERE clerk_membership_id = membership_clerk_id;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Outbox drain windows (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- The drain cron runs as platform_runtime with no tenant. These two functions
-- are its entire reach into the tenant-owned queue.

CREATE OR REPLACE FUNCTION claim_ready_outbox_messages(batch_size integer)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  topic text,
  key text,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF batch_size < 1 OR batch_size > 200 THEN
    RAISE EXCEPTION 'batch_size must be between 1 and 200.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT outbox.id
    FROM transactional_outbox AS outbox
    WHERE outbox.status IN ('pending', 'failed')
      AND outbox.next_attempt_at <= now()
      AND outbox.attempts < 12
    ORDER BY outbox.next_attempt_at, outbox.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE transactional_outbox AS outbox
  SET
    status = 'claimed',
    attempts = outbox.attempts + 1,
    claimed_until = now() + interval '5 minutes',
    updated_at = now()
  FROM claimed
  WHERE outbox.id = claimed.id
  RETURNING outbox.id, outbox.organization_id, outbox.topic, outbox.key, outbox.payload;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION finish_outbox_message(
  target_id uuid,
  succeeded boolean,
  error_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF succeeded THEN
    UPDATE transactional_outbox
    SET status = 'sent', sent_at = now(), claimed_until = NULL, updated_at = now()
    WHERE id = target_id;
  ELSE
    UPDATE transactional_outbox
    SET
      status = CASE WHEN attempts >= 12 THEN 'dead' ELSE 'failed' END,
      next_attempt_at = now() + (least(attempts, 10) * interval '60 seconds'),
      last_error = left(coalesce(error_text, ''), 500),
      claimed_until = NULL,
      updated_at = now()
    WHERE id = target_id;
  END IF;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE platform_users FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE clerk_webhook_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE clerk_webhook_events FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE customer_access_grants ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE customer_access_grants FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE transactional_outbox ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE transactional_outbox FORCE ROW LEVEL SECURITY;

-- migrate:split

-- Platform users are read by a tenant only for its own members.
-- platform_runtime has NO policy here: the only way it touches a platform user
-- is through the SECURITY DEFINER identity windows.
CREATE POLICY platform_users_control_manages ON platform_users
  FOR ALL TO control_app
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY platform_users_tenant_reads_members ON platform_users
  FOR SELECT TO contractor_app
  USING (
    EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      WHERE membership.organization_id = app_current_organization_id()
        AND membership.platform_user_id = platform_users.id
    )
  );

-- migrate:split

CREATE POLICY organization_memberships_tenant_isolation ON organization_memberships
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY organization_memberships_control_manages ON organization_memberships
  FOR ALL TO control_app
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY clerk_webhook_events_platform_manages ON clerk_webhook_events
  FOR ALL TO platform_runtime
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY clerk_webhook_events_control_manages ON clerk_webhook_events
  FOR ALL TO control_app
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY customer_access_grants_tenant_isolation ON customer_access_grants
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY transactional_outbox_tenant_isolation ON transactional_outbox
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT
  ON platform_users, organization_memberships
  TO contractor_app;

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_users, organization_memberships, clerk_webhook_events
  TO control_app;

-- migrate:split

-- platform_runtime's only direct table grant here is the platform-owned webhook
-- event log; identity rows and the outbox reach it exclusively through the
-- SECURITY DEFINER functions granted below.
GRANT SELECT, INSERT, UPDATE
  ON clerk_webhook_events
  TO platform_runtime;

-- migrate:split

GRANT SELECT, INSERT, UPDATE
  ON customer_access_grants, transactional_outbox
  TO contractor_app;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  upsert_platform_user(text, text, text, boolean),
  deactivate_platform_user(text),
  link_organization_clerk(uuid, text),
  resolve_organization_by_clerk_id(text),
  suspend_organization_by_clerk_id(text),
  upsert_clerk_membership(text, text, text, text, text, text, boolean),
  revoke_clerk_membership(text),
  claim_ready_outbox_messages(integer),
  finish_outbox_message(uuid, boolean, text)
  TO platform_runtime, control_app;
