-- 020_ai_tool_audit.sql
--
-- Durable audit ledger for AI tool authorization and execution events.
-- This is intentionally separate from model/provider telemetry: it records
-- application behavior and authority decisions, not private model reasoning.

CREATE TABLE IF NOT EXISTS ai_tool_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  tool_name text NOT NULL CHECK (char_length(tool_name) BETWEEN 1 AND 200),
  risk text NOT NULL CHECK (risk IN ('read', 'write', 'financial', 'destructive')),
  outcome text NOT NULL CHECK (outcome IN ('authorized', 'denied', 'confirmation_required', 'executed', 'failed')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (actor_id, organization_id)
    REFERENCES ai_actors(id, organization_id) ON DELETE RESTRICT
);

-- migrate:split

CREATE INDEX IF NOT EXISTS ai_tool_audit_events_request_idx
  ON ai_tool_audit_events (organization_id, request_id, created_at, id);

-- migrate:split

CREATE INDEX IF NOT EXISTS ai_tool_audit_events_actor_idx
  ON ai_tool_audit_events (organization_id, actor_id, created_at DESC, id);

-- migrate:split

ALTER TABLE ai_tool_audit_events ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE ai_tool_audit_events FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY ai_tool_audit_events_tenant_isolation ON ai_tool_audit_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_tool_audit_events TO contractor_app;

COMMENT ON TABLE ai_tool_audit_events IS
  'Durable application audit events for AI tool authorization and execution; excludes private model chain-of-thought.';
