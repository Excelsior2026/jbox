-- 007_native_field_auth.sql
--
-- First-party email/password authentication for the Field workspace, replacing
-- the Clerk identity provider. The JWT scheme ports TrueTraining's auth-service
-- pattern (ADRs in TrueTraining/docs/architecture/adr/):
--
--   - platform_users gains password_hash; the identity row is now also a
--     credential (TrueTraining User.password_hash).
--   - field_sessions is the active-session ledger, jti-keyed. It plays the part
--     TrueTraining's Redis active-JTI set and denylist play (SEC-07): a token
--     is valid only while its jti row exists, is not revoked, and has not
--     expired. Logout revokes the row; a role or status change revokes every
--     row for the user (role-change revocation).
--   - Two SECURITY DEFINER windows give platform_runtime (the auth service
--     role) a narrow, search_path-pinned path across the RLS boundary: one to
--     read the credential + active membership at login, one to re-read the live
--     membership when a token is presented. Nothing else broadens the boundary.

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS password_hash text
    CHECK (password_hash IS NULL OR char_length(password_hash) BETWEEN 20 AND 255);

-- migrate:split

-- Email is the identity key for first-party auth (it was only the lookup
-- surface before). Lowercased inserts and lookups make the key case-insensitive.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_users_email_key'
      AND conrelid = 'platform_users'::regclass
  ) THEN
    ALTER TABLE platform_users
      ADD CONSTRAINT platform_users_email_key UNIQUE (email);
  END IF;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
-- Platform-owned: like platform_users there is no single owning tenant, and only
-- the auth service (platform_runtime) and the control plane manage it. A
-- session is created at login and revoked at logout, on role change, or on
-- status change; expired rows are never extended, only cleaned up.

CREATE TABLE IF NOT EXISTS field_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jti text NOT NULL UNIQUE
    CHECK (char_length(jti) BETWEEN 10 AND 80),
  platform_user_id uuid NOT NULL
    REFERENCES platform_users (id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'office', 'technician')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (expires_at > issued_at),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS field_sessions_user_idx
  ON field_sessions (platform_user_id, expires_at DESC);

-- migrate:split

CREATE INDEX IF NOT EXISTS field_sessions_org_idx
  ON field_sessions (organization_id, expires_at DESC);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Auth windows (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- The auth routes run as platform_runtime with no tenant. platform_runtime has
-- no policy on the tenant-owned membership table, so login reads the credential
-- and the membership through one narrow function and token verification
-- re-reads the live membership through another. Both raise rather than return
-- partial rows, and both are pinned to search_path.

CREATE OR REPLACE FUNCTION staff_login_lookup(p_email text, p_organization_id uuid)
RETURNS TABLE (
  platform_user_id uuid,
  email text,
  display_name text,
  password_hash text,
  membership_id uuid,
  role text,
  mfa_required boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    platform_user.id,
    platform_user.email,
    platform_user.display_name,
    platform_user.password_hash,
    membership.id,
    membership.role,
    membership.mfa_required
  FROM platform_users AS platform_user
  JOIN organization_memberships AS membership
    ON membership.platform_user_id = platform_user.id
  JOIN organizations AS organization
    ON organization.id = membership.organization_id
  WHERE platform_user.email = p_email
    AND membership.organization_id = p_organization_id
    AND platform_user.status = 'active'
    AND platform_user.identity_deleted_at IS NULL
    AND membership.status = 'active'
    AND organization.status = 'active'
  LIMIT 1;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION staff_session_membership(p_user_id uuid, p_organization_id uuid)
RETURNS TABLE (
  membership_id uuid,
  role text,
  mfa_required boolean,
  display_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT membership.id, membership.role, membership.mfa_required, platform_user.display_name
  FROM organization_memberships AS membership
  JOIN platform_users AS platform_user
    ON platform_user.id = membership.platform_user_id
  JOIN organizations AS organization
    ON organization.id = membership.organization_id
  WHERE membership.platform_user_id = p_user_id
    AND membership.organization_id = p_organization_id
    AND membership.status = 'active'
    AND platform_user.status = 'active'
    AND platform_user.identity_deleted_at IS NULL
    AND organization.status = 'active'
  LIMIT 1;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION revoke_field_sessions_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE field_sessions
  SET revoked_at = now()
  WHERE platform_user_id = p_user_id
    AND revoked_at IS NULL
    AND expires_at > now();
END;
$$;

-- migrate:split

-- Active memberships for a login whose request did not name an organization.
-- The auth route uses this to pick a single default organization and to list
-- the choices when the email has several.

CREATE OR REPLACE FUNCTION staff_memberships_for_email(p_email text)
RETURNS TABLE (
  organization_id uuid,
  membership_id uuid,
  role text,
  mfa_required boolean,
  display_name text,
  email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    membership.organization_id,
    membership.id,
    membership.role,
    membership.mfa_required,
    platform_user.display_name,
    platform_user.email
  FROM platform_users AS platform_user
  JOIN organization_memberships AS membership
    ON membership.platform_user_id = platform_user.id
  JOIN organizations AS organization
    ON organization.id = membership.organization_id
  WHERE platform_user.email = lower(p_email)
    AND platform_user.status = 'active'
    AND platform_user.identity_deleted_at IS NULL
    AND membership.status = 'active'
    AND organization.status = 'active'
  ORDER BY membership.created_at, membership.id;
END;
$$;

-- migrate:split

-- Provision (or re-activate) a staff member and their membership in one window:
-- the register route's entire reach into the identity tables. Passwords arrive
-- already hashed by the application. Re-provisioning the same email updates the
-- profile and password, and re-activates a previously revoked membership.

CREATE OR REPLACE FUNCTION provision_staff_member(
  p_email text,
  p_display_name text,
  p_password_hash text,
  p_organization_id uuid,
  p_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  user_id uuid;
BEGIN
  INSERT INTO platform_users (email, display_name, status, password_hash, identity_deleted_at)
  VALUES (lower(p_email), coalesce(nullif(p_display_name, ''), 'Staff member'), 'active', p_password_hash, NULL)
  ON CONFLICT (email) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    status = 'active',
    identity_deleted_at = NULL,
    password_hash = coalesce(EXCLUDED.password_hash, platform_users.password_hash),
    updated_at = now()
  RETURNING id INTO user_id;

  INSERT INTO organization_memberships (
    organization_id, platform_user_id, clerk_membership_id, role, status, mfa_required
  )
  VALUES (p_organization_id, user_id, 'native-' || user_id::text, p_role, 'active', false)
  ON CONFLICT (organization_id, platform_user_id) DO UPDATE SET
    role = EXCLUDED.role,
    status = 'active',
    revoked_at = NULL,
    accepted_at = coalesce(organization_memberships.accepted_at, now()),
    updated_at = now();

  RETURN user_id;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

ALTER TABLE field_sessions ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE field_sessions FORCE ROW LEVEL SECURITY;
-- migrate:split

CREATE POLICY field_sessions_platform_manages ON field_sessions
  FOR ALL TO platform_runtime
  USING (true)
  WITH CHECK (true);

-- migrate:split

CREATE POLICY field_sessions_control_manages ON field_sessions
  FOR ALL TO control_app
  USING (true)
  WITH CHECK (true);

-- migrate:split

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE
  ON field_sessions
  TO platform_runtime;

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON field_sessions
  TO control_app;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  staff_login_lookup(text, uuid),
  staff_session_membership(uuid, uuid),
  revoke_field_sessions_for_user(uuid),
  staff_memberships_for_email(text),
  provision_staff_member(text, text, text, uuid, text)
  TO platform_runtime, control_app;
