-- 014_platform_runtime_observability.sql
--
-- Two narrow SECURITY DEFINER windows for platform_runtime:
--
--   count_dead_outbox_messages()
--     Returns the number of dead-lettered outbox messages across all tenants.
--     The health endpoint calls this to surface silent dead-letter accumulation
--     as a numeric signal (0 is healthy; any positive value should alert).
--
--   resolve_organization_subscription(p_organization_id uuid)
--     Returns the subscription_status and subscription_plan columns for a
--     single organization. Used by the Field API auth path to enforce gate 1
--     (subscription in good standing) without granting platform_runtime a
--     direct SELECT on organizations.

-- migrate:split

CREATE OR REPLACE FUNCTION count_dead_outbox_messages()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::integer
  FROM transactional_outbox
  WHERE status = 'dead'
$$;

-- migrate:split

CREATE OR REPLACE FUNCTION resolve_organization_subscription(p_organization_id uuid)
RETURNS TABLE (
  subscription_status text,
  subscription_plan   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT subscription_status, subscription_plan
  FROM   organizations
  WHERE  id = p_organization_id
$$;

-- migrate:split

GRANT EXECUTE ON FUNCTION
  count_dead_outbox_messages(),
  resolve_organization_subscription(uuid)
  TO platform_runtime, control_app;
