-- 013_subscription_billing.sql
--
-- Platform-level subscription state for SaaS billing via Stripe.
--
-- Design decisions:
--   - Subscription state lives on organizations, not on tenants. The platform
--     is responsible for billing; a tenant cannot alter its own subscription row.
--   - stripe_customer_id and stripe_subscription_id are stored here so webhooks
--     can resolve the organization without a lookup by email.
--   - subscription_status mirrors the Stripe status vocabulary exactly so the
--     application can gate on it without mapping.
--   - Managed by control_app + platform_runtime only; contractor_app has no
--     INSERT/UPDATE policy on subscriptions.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id text
    CHECK (stripe_customer_id IS NULL OR char_length(stripe_customer_id) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text
    CHECK (stripe_subscription_id IS NULL OR char_length(stripe_subscription_id) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete',
      'incomplete_expired', 'paused'
    )),
  ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_plan text
    CHECK (subscription_plan IS NULL OR char_length(subscription_plan) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer_id_idx
  ON organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_subscription_id_idx
  ON organizations (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- migrate:split

-- The outbox already drains notifications; subscribe to subscription events
-- by adding them to the transactional_outbox when status changes. This function
-- updates the organization and, if called from webhook context, does NOT run
-- inside a tenant context — platform_runtime sets no app.organization_id here.
CREATE OR REPLACE FUNCTION sync_stripe_subscription(
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_plan text,
  p_period_end timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  org_id uuid;
BEGIN
  UPDATE organizations
  SET
    stripe_subscription_id = p_stripe_subscription_id,
    subscription_status = p_status,
    subscription_plan = p_plan,
    subscription_current_period_end = p_period_end,
    updated_at = now()
  WHERE stripe_customer_id = p_stripe_customer_id
  RETURNING id INTO org_id;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Organization with Stripe customer % not found.', p_stripe_customer_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Activate the organization when subscription becomes active/trialing for
  -- the first time (transitions from 'provisioning').
  UPDATE organizations
  SET status = 'active', updated_at = now()
  WHERE id = org_id
    AND status = 'provisioning'
    AND p_status IN ('active', 'trialing');

  RETURN org_id;
END;
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION link_stripe_customer(
  p_organization_id uuid,
  p_stripe_customer_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE organizations
  SET stripe_customer_id = p_stripe_customer_id, updated_at = now()
  WHERE id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization % not found.', p_organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  sync_stripe_subscription(text, text, text, text, timestamptz),
  link_stripe_customer(uuid, text)
  TO platform_runtime, control_app;
