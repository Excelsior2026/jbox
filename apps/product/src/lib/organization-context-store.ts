import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

export type OrganizationContext = {
  organizationId: string;
  actorId: string | null;
  requestId: string;
};

const storage = new AsyncLocalStorage<OrganizationContext>();

/**
 * Runs `work` with tenant context established for its whole async subtree.
 *
 * AsyncLocalStorage rather than a module-level variable: serverless instances
 * handle concurrent requests, and a shared mutable "current organization"
 * would let one request read another tenant's context between awaits. That is
 * the kind of bug that appears only under load and looks like data corruption.
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
 * Tenant context or an exception — never a fallback.
 *
 * The database refuses unscoped writes as well (`app_require_organization_id()`
 * raises), so this is defence in depth rather than the only guard. Both layers
 * exist because the application can be wrong and the schema is what makes that
 * wrongness loud instead of silent.
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
