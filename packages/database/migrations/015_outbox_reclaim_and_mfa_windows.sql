-- 015_outbox_reclaim_and_mfa_windows.sql
--
-- 1. OUTBOX CLAIM LEASE RECOVERY
--    Reclaims messages stranded in 'claimed' status after worker timeout/crash
--    once their claimed_until timestamp has expired (<= now()).
--
-- 2. SECURE MULTI-TENANT CREDENTIAL & MFA WINDOWS
--    Provides SECURITY DEFINER functions for platform_runtime to manage
--    MFA lifecycle and password check without direct unprivileged table access.
--
-- 3. BILLING STRIPE CUSTOMER RESOLUTION WINDOW
--    Enables platform_runtime to resolve an organization's stripe_customer_id
--    for billing portal sessions.
--
-- 4. MEMBERSHIP UNIQUE CONSTRAINT FIX
--    Relaxes global clerk_membership_id unique constraint to allow a platform
--    user to join multiple organizations under native auth.

-- ---------------------------------------------------------------------------
-- 1. Outbox claim lease recovery
-- ---------------------------------------------------------------------------

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
    WHERE (
      outbox.status IN ('pending', 'failed')
      OR (outbox.status = 'claimed' AND outbox.claimed_until <= now())
    )
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

-- ---------------------------------------------------------------------------
-- 2. Credential & MFA windows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION staff_user_credential_lookup(p_email text)
RETURNS TABLE (
  platform_user_id uuid,
  password_hash text,
  totp_secret text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT pu.id, pu.password_hash, pu.totp_secret
  FROM platform_users AS pu
  WHERE pu.email = lower(p_email)
    AND pu.status = 'active'
    AND pu.identity_deleted_at IS NULL
  LIMIT 1;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION staff_mfa_initiate(
  p_user_id uuid,
  p_totp_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE platform_users
  SET totp_secret = p_totp_secret, updated_at = now()
  WHERE id = p_user_id
    AND status = 'active'
    AND identity_deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active user % not found.', p_user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION staff_mfa_complete(
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organization_memberships
  SET mfa_required = true, updated_at = now()
  WHERE platform_user_id = p_user_id
    AND organization_id = p_organization_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active membership not found for user % in org %.', p_user_id, p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  PERFORM revoke_field_sessions_for_user(p_user_id);
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION staff_mfa_disable(
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  other_mfa_count integer;
BEGIN
  UPDATE organization_memberships
  SET mfa_required = false, updated_at = now()
  WHERE platform_user_id = p_user_id
    AND organization_id = p_organization_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active membership not found for user % in org %.', p_user_id, p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Only clear totp_secret if NO other active memberships require MFA
  SELECT COUNT(*)::integer INTO other_mfa_count
  FROM organization_memberships
  WHERE platform_user_id = p_user_id
    AND status = 'active'
    AND mfa_required = true;

  IF other_mfa_count = 0 THEN
    UPDATE platform_users
    SET totp_secret = NULL, updated_at = now()
    WHERE id = p_user_id;
  END IF;

  PERFORM revoke_field_sessions_for_user(p_user_id);
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 3. Billing Stripe customer resolution window
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION resolve_organization_stripe_customer(p_organization_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT stripe_customer_id
  FROM organizations
  WHERE id = p_organization_id
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 4. Membership Clerk unique constraint relaxation
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_memberships_clerk_membership_id_key'
      AND conrelid = 'organization_memberships'::regclass
  ) THEN
    ALTER TABLE organization_memberships
      DROP CONSTRAINT organization_memberships_clerk_membership_id_key;
  END IF;
END;
$$;

-- migrate:split

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  claim_ready_outbox_messages(integer),
  staff_user_credential_lookup(text),
  staff_mfa_initiate(uuid, text),
  staff_mfa_complete(uuid, uuid),
  staff_mfa_disable(uuid, uuid),
  resolve_organization_stripe_customer(uuid)
  TO platform_runtime, control_app;
