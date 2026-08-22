import 'server-only';

import { currentOrganizationContext, runWithOrganizationContext } from '@/lib/organization-context-store';
import type { AiActorContext, AiActorRole } from '@contractor-platform/ai/agent';

/**
 * AI is an application actor, never an implicit execution context.
 *
 * The persistent actor UUID is the authoritative identity. actorKey is the
 * stable human-readable namespace (for example ai:assistant:jbox). The model
 * can never manufacture either value.
 */
export type AiActorIdentity = {
  actorId: string;
  actorKey: string;
  role: AiActorRole;
};

export type AiActorResolver = {
  resolve: (input: {
    organizationId: string;
    actorId: string;
  }) => Promise<AiActorIdentity | null>;
};

/**
 * Requires an actor that has already been established by the application's
 * persistent identity authority.
 */
export async function requireAiActorContext(
  resolver: AiActorResolver,
): Promise<AiActorContext> {
  const context = currentOrganizationContext();
  if (!context) {
    throw new Error('AI actor context required outside tenant context');
  }
  if (!context.actorId) {
    throw new Error('AI actor context requires an auditable actorId');
  }

  const identity = await resolver.resolve({
    organizationId: context.organizationId,
    actorId: context.actorId,
  });

  if (!identity) {
    throw new Error(`Unknown or inactive AI actor: ${context.actorId}`);
  }

  if (!identity.actorKey.startsWith('ai:')) {
    throw new Error(`Invalid AI actor namespace: ${identity.actorKey}`);
  }

  return {
    requestId: context.requestId,
    organizationId: context.organizationId,
    actorId: identity.actorId,
    actorKey: identity.actorKey,
    role: identity.role,
    source: 'ai',
  };
}

/**
 * Runs AI work as a first-class application actor. The caller supplies an
 * identity previously resolved from JBox's authoritative actor store.
 */
export function runAsAiActor<T>(
  identity: AiActorIdentity,
  work: () => Promise<T>,
): Promise<T> {
  const parent = currentOrganizationContext();
  if (!parent) {
    throw new Error('AI actor work must begin inside organization context');
  }

  if (identity.organizationId && identity.organizationId !== parent.organizationId) {
    throw new Error('AI actor organization does not match request organization');
  }

  if (!identity.actorKey.startsWith('ai:')) {
    throw new Error('AI actor IDs must use the ai: namespace');
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
