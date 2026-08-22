import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

export type OrganizationContext = {
  organizationId: string;
  /** Every application actor, including AI, must have an auditable actor ID. */
  actorId: string | null;
  requestId: string;
};

const storage = new AsyncLocalStorage<OrganizationContext>();

/**
 * Runs work with tenant and actor context established for its whole async subtree.
 *
 * AsyncLocalStorage rather than a module-level variable: serverless instances
 * handle concurrent requests, and a shared mutable "current organization"
 * would let one request read another tenant's context between awaits.
 */
export function runWithOrganizationContext<T>(
  context: OrganizationContext,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(context, work);
}

export function currentOrganizationContext(): OrganizationContext | undefined {
  return storage.getStore();
}

/**
 * Tenant and actor context or an exception — never a fallback.
 */
export function requireOrganizationContext(): OrganizationContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error(
      'No organization context. Tenant-scoped work must run inside '
      + 'runWithOrganizationContext(); use platformDb() for genuinely '
      + 'cross-tenant paths such as webhooks and cron.',
    );
  }
  return context;
}

/**
 * AI and other actor-sensitive operations use this stronger guard when an
 * auditable actor identity is mandatory.
 */
export function requireActorContext(): OrganizationContext & { actorId: string } {
  const context = requireOrganizationContext();
  if (!context.actorId) {
    throw new Error('Actor context required; anonymous execution is forbidden');
  }
  return context as OrganizationContext & { actorId: string };
}
