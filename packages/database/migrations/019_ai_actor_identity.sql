-- 019_ai_actor_identity.sql
--
-- AI is a first-class application actor. The actor is organization-scoped,
-- persistent, revocable, and distinct from the human principal that may have
-- initiated a request. Model identity belongs in metadata; actor identity does
-- not change when the underlying model changes.

CREATE TABLE IF NOT EXISTS ai_actors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_key text NOT NULL
    CHECK (actor_key ~ '^ai:[a-z0-9][a-z0-9._:-]{0,127}$'),
  display_name text NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 160),
  authority_role text NOT NULL DEFAULT 'operator'
    CHECK (authority_role IN ('operator', 'manager', 'owner')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  model_provider text
    CHECK (model_provider IS NULL OR char_length(model_provider) BETWEEN 1 AND 120),
  model_name text
    CHECK (model_name IS NULL OR char_length(model_name) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,

  UNIQUE (organization_id, actor_key),
  UNIQUE (id, organization_id),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CHECK (status = 'revoked' OR revoked_at IS NULL)
);

-- migrate:split

CREATE INDEX IF NOT EXISTS ai_actors_org_status_idx
  ON ai_actors (organization_id, status);

-- migrate:split

ALTER TABLE ai_actors ENABLE ROW LEVEL SECURITY;

-- migrate:split

ALTER TABLE ai_actors FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY ai_actors_tenant_isolation ON ai_actors
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_actors TO contractor_app;

-- migrate:split

-- The AI actor itself is a tenant-owned identity. Creation should therefore
-- occur inside the normal tenant context and remain subject to the same RLS
-- boundary as other tenant-owned records.
COMMENT ON TABLE ai_actors IS
  'Persistent application identities for intelligent actors. AI never executes anonymously.';

COMMENT ON COLUMN ai_actors.actor_key IS
  'Stable human-readable AI actor identity; namespaced with ai:. Model changes do not change this identity.';

COMMENT ON COLUMN ai_actors.authority_role IS
  'Maximum governance role for this AI actor; operation-specific policy still applies.';
