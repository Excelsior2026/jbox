-- 009_mfa_totp.sql
--
-- TOTP-based MFA for first-party Field authentication.
-- Follows RFC 6238 with 30-second windows, SHA1, 6-digit codes.

-- ---------------------------------------------------------------------------
-- TOTP secret storage
-- ---------------------------------------------------------------------------

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS totp_secret text
    CHECK (totp_secret IS NULL OR char_length(totp_secret) = 32);

-- Base32-encoded secret for QR code generation (not stored, derived on demand)
-- migrate:split

-- ---------------------------------------------------------------------------
-- MFA enrollment status
-- ---------------------------------------------------------------------------

-- mfa_required on organization_memberships already exists from 005/007
-- When true, login requires TOTP challenge after password verification

-- ---------------------------------------------------------------------------
-- Auth window updates
-- ---------------------------------------------------------------------------

-- Update staff_login_lookup to return totp_secret for MFA challenge
-- CREATE OR REPLACE cannot change a function's return type, and 007 already
-- created the 7-column shape, so drop the old shape before recreating it.
DROP FUNCTION IF EXISTS staff_login_lookup(text, uuid);
CREATE OR REPLACE FUNCTION staff_login_lookup(p_email text, p_organization_id uuid)
RETURNS TABLE (
  platform_user_id uuid,
  email text,
  display_name text,
  password_hash text,
  membership_id uuid,
  role text,
  mfa_required boolean,
  totp_secret text
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
    membership.mfa_required,
    platform_user.totp_secret
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

-- Update staff_memberships_for_email to include totp_secret
DROP FUNCTION IF EXISTS staff_memberships_for_email(text);
CREATE OR REPLACE FUNCTION staff_memberships_for_email(p_email text)
RETURNS TABLE (
  organization_id uuid,
  membership_id uuid,
  role text,
  mfa_required boolean,
  display_name text,
  email text,
  totp_secret text
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
    platform_user.email,
    platform_user.totp_secret
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

-- Grant execute on updated functions
GRANT EXECUTE ON FUNCTION
  staff_login_lookup(text, uuid),
  staff_memberships_for_email(text)
  TO platform_runtime, control_app;