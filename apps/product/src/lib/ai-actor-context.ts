import 'server-only';

import { currentOrganizationContext, runWithOrganizationContext } from '@/lib/organization-context-store';
import type { AiActorContext, AiActorRole } from '@contractor-platform/ai/agent';

/**
 * AI is an application actor, never an implicit execution context.
 *
 * Any model-driven reasoning or tool execution must carry an auditable actorId.
 * The actor is scoped to the tenant and request, and is propagated through the
 * same AsyncLocalStorage context used by ordinary application work.
 */
export type AiActorIdentity = {
  actorId: string;
  role: AiActorRole;
};

export function requireAiActorContext(): AiActorContext {
  const context = currentOrganizationContext();
  if (!context) {
    throw new Error('AI actor context required outside tenant context');
  }
  if (!context.actorId) {
    throw new Error('AI actor context requires an auditable actorId');
  }

  const metadata = aiActorRegistry.get(context.actorId);
  if (!metadata) {
    throw new Error(`Unknown AI actor: ${context.actorId}`);
  }

  return {
    requestId: context.requestId,
    organizationId: context.organizationId,
    actorId: metadata.actorId,
    role: metadata.role,
    source: 'ai',
  };
}

/**
 * Runs AI work as a first-class application actor. The caller must supply an
 * actor ID issued by JBox's identity/authorization layer; arbitrary model text
 * can never manufacture an actor identity.
 */
export function runAsAiActor<T>(
  identity: AiActorIdentity,
  work: () => Promise<T>,
): Promise<T> {
  const parent = currentOrganizationContext();
  if (!parent) {
    throw new Error('AI actor work must begin inside organization context');
  }

  if (!aiActorRegistry.has(identity.actorId)) {
    throw new Error(`Unknown AI actor: ${identity.actorId}`);
  }

  return runWithOrganizationContext(
    {
      organizationId: parent.organizationId,
      actorId: identity.actorId,
      requestId: parent.requestId,
    },
    work,
  );
}

/**
 * Temporary in-process registry for the bridge. This is deliberately narrow:
 * production wiring should resolve these identities from the application's
 * persistent actor/identity authority rather than allowing arbitrary IDs.
 */
const aiActorRegistry = new Map<string, AiActorIdentity>();

export function registerAiActor(identity: AiActorIdentity): void {
  if (!identity.actorId.startsWith('ai:')) {
    throw new Error('AI actor IDs must use the ai: namespace');
  }
  aiActorRegistry.set(identity.actorId, identity);
}
