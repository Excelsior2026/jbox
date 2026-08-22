import 'server-only';

import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';
import type { AiActorIdentity, AiActorResolver } from './ai-actor-context';
import type { AiActorRole } from '@contractor-platform/ai/agent';

type AiActorRow = {
  id: string;
  organization_id: string;
  actor_key: string;
  authority_role: AiActorRole;
  status: 'active' | 'suspended' | 'revoked';
};

function mapActor(row: AiActorRow): AiActorIdentity | null {
  if (row.status !== 'active') return null;
  return {
    organizationId: row.organization_id,
    actorId: row.id,
    actorKey: row.actor_key,
    role: row.authority_role,
  };
}

/** Resolves only the AI actor belonging to the current tenant. */
export const aiActorResolver: AiActorResolver = {
  async resolve({ organizationId, actorId }) {
    const context = requireOrganizationContext();
    if (context.organizationId !== organizationId) {
      throw new Error('AI actor resolution crossed organization boundary');
    }

    const rows = await db().query(
      `SELECT id, organization_id, actor_key, authority_role, status
         FROM ai_actors
        WHERE id = $1::uuid
          AND organization_id = $2::uuid
        LIMIT 1`,
      [actorId, organizationId],
    );

    return mapActor((rows[0] as unknown as AiActorRow) ?? null);
  },
};

/**
 * Creates a stable AI actor identity for the current tenant.
 *
 * This operation is intentionally explicit: actor identities are provisioned
 * by application code, never by model output. Calling code must already be in
 * an authenticated tenant context.
 */
export async function provisionAiActor(input: {
  actorKey: string;
  displayName: string;
  authorityRole?: AiActorRole;
  modelProvider?: string | null;
  modelName?: string | null;
}): Promise<AiActorIdentity> {
  const context = requireOrganizationContext();

  if (!input.actorKey.startsWith('ai:')) {
    throw new Error('AI actor keys must use the ai: namespace');
  }

  const rows = await db().query(
    `INSERT INTO ai_actors (
       organization_id, actor_key, display_name, authority_role,
       model_provider, model_name
     )
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     ON CONFLICT (organization_id, actor_key)
     DO UPDATE SET
       display_name = EXCLUDED.display_name,
       authority_role = EXCLUDED.authority_role,
       model_provider = EXCLUDED.model_provider,
       model_name = EXCLUDED.model_name,
       status = 'active',
       revoked_at = NULL,
       updated_at = now()
     RETURNING id, organization_id, actor_key, authority_role, status`,
    [
      context.organizationId,
      input.actorKey,
      input.displayName,
      input.authorityRole ?? 'operator',
      input.modelProvider ?? null,
      input.modelName ?? null,
    ],
  );

  const identity = mapActor((rows[0] as unknown as AiActorRow) ?? null);
  if (!identity) throw new Error('AI actor provisioning did not return an active actor');
  return identity;
}
