import 'server-only';

import { auth } from '@clerk/nextjs/server';
import {
  capabilitiesForRole,
  type ApplicationRole,
  type Capability,
} from '@contractor-platform/domain';
import { db, platformDb } from '@/lib/db';
import {
  applicationRoleForClerkRole,
  sessionSatisfiesMfa,
} from '@/lib/identity';
import { clerkIdentityState } from '@/lib/identity-environment';
import { runWithOrganizationContext } from '@/lib/organization-context-store';

/**
 * Field API authorization for jbox.
 *
 * jbox differs from the prototype in one structural way: there is no mutable
 * "current organization". Tenant context is established per subtree by
 * runWithOrganizationContext() (see lib/organization-context-store.ts), and the
 * database refuses unscoped writes. So resolving a principal and running the
 * request's work are two distinct phases:
 *
 *   1. getFieldPrincipal() -- Clerk session -> internal organization id ->
 *      active membership. Returns a principal carrying the organization id and
 *      actor id, or null when the request has no usable Field identity.
 *
 *   2. The route wraps its DB work in withFieldContext() using that principal,
 *      so every tenant query runs as contractor_app under the RLS boundary the
 *      principal authenticated for.
 *
 * The Clerk session's organization external id is mapped onto an internal one
 * through the SECURITY DEFINER window resolve_organization_by_clerk_id() from
 * migration 005 -- the same window the webhook uses, so a Clerk org that was
 * never provisioned fails closed here too. That lookup runs on platformDb()
 * (the window is granted to platform_runtime); the membership read runs on
 * db() inside tenant context, because the membership tables are RLS-enforced
 * tenant tables and platform_runtime has no policy on them.
 */

export type FieldPrincipal = {
  kind: 'clerk' | 'development';
  organizationId: string;
  actorId: string | null;
  membershipId: string;
  role: ApplicationRole;
  capabilities: ReadonlySet<Capability>;
};

type MembershipRow = {
  actor_id: string;
  membership_id: string;
  role: ApplicationRole;
  mfa_required: boolean;
};

export async function resolveClerkFieldPrincipal(): Promise<FieldPrincipal | null> {
  if (clerkIdentityState() !== 'configured') return null;

  let session;
  try {
    session = await auth({
      acceptsToken: 'session_token',
      treatPendingAsSignedOut: true,
    });
  } catch (error) {
    console.error('Clerk session verification failed.', {
      code: error instanceof Error ? error.name : 'unknown_error',
    });
    return null;
  }

  if (
    !session.isAuthenticated
    || !session.userId
    || !session.orgId
    || session.actor
  ) {
    return null;
  }

  const claimedRole = applicationRoleForClerkRole(session.orgRole ?? null);
  if (!claimedRole) return null;

  let organizationRows: Array<{ organization_id: string }> = [];
  try {
    organizationRows = (await platformDb().query(
      'SELECT resolve_organization_by_clerk_id($1) AS organization_id',
      [session.orgId],
    )) as Array<{ organization_id: string }>;
  } catch {
    return null;
  }
  const organizationId = organizationRows[0]?.organization_id;
  if (typeof organizationId !== 'string') return null;

  const principal = await runWithOrganizationContext(
    {
      organizationId,
      actorId: null,
      requestId: crypto.randomUUID(),
    },
    async () => {
      let rows: MembershipRow[] = [];
      try {
        rows = (await db().query(
          `SELECT
             platform_user.id AS actor_id,
             membership.id AS membership_id,
             membership.role,
             membership.mfa_required
           FROM organization_memberships AS membership
           JOIN platform_users AS platform_user
             ON platform_user.id = membership.platform_user_id
            AND platform_user.status = 'active'
            AND platform_user.identity_deleted_at IS NULL
           JOIN organizations AS organization
             ON organization.id = membership.organization_id
            AND organization.status = 'active'
           WHERE membership.organization_id = app_current_organization_id()
             AND membership.status = 'active'
             AND platform_user.clerk_user_id = $1
           LIMIT 1`,
          [session.userId],
        )) as MembershipRow[];
      } catch {
        return null;
      }
      const membership = rows[0];
      if (!membership || membership.role !== claimedRole) return null;

      if (
        membership.mfa_required
        && !sessionSatisfiesMfa(session.factorVerificationAge)
      ) {
        return null;
      }

      return {
        kind: 'clerk' as const,
        organizationId,
        actorId: membership.actor_id,
        membershipId: membership.membership_id,
        role: membership.role,
        capabilities: capabilitiesForRole(membership.role),
      };
    },
  );

  return principal;
}

/**
 * Development fallback: when Clerk identity is not configured and we are not in
 * production, resolve the configured default organization so the Field UI can be
 * developed and tested against a database-backed tenant. There is no real
 * membership in this mode; the organization id comes from the deployment
 * environment rather than a request.
 */
export async function resolveDevelopmentFieldPrincipal(): Promise<FieldPrincipal | null> {
  if (process.env.NODE_ENV === 'production' || clerkIdentityState() !== 'disabled') {
    return null;
  }
  const organizationId = process.env.DEVELOPMENT_FIELD_ORGANIZATION_ID?.trim() ?? '';
  if (!organizationId) return null;

  return {
    kind: 'development',
    organizationId,
    actorId: null,
    membershipId: '',
    role: 'owner',
    capabilities: capabilitiesForRole('owner'),
  };
}

export async function getFieldPrincipal(): Promise<FieldPrincipal | null> {
  const clerkPrincipal = await resolveClerkFieldPrincipal();
  if (clerkPrincipal) return clerkPrincipal;
  return resolveDevelopmentFieldPrincipal();
}

export function fieldPrincipalCan(
  principal: FieldPrincipal | null,
  capability: Capability,
): principal is FieldPrincipal {
  return Boolean(principal && principal.capabilities.has(capability));
}

/**
 * Runs `work` in the tenant context the principal authenticated for, so every
 * query is RLS-scoped to that organization and attributed to the actor.
 */
export async function withFieldContext<T>(
  principal: FieldPrincipal,
  work: () => Promise<T>,
): Promise<T> {
  return runWithOrganizationContext(
    {
      organizationId: principal.organizationId,
      actorId: principal.actorId,
      requestId: crypto.randomUUID(),
    },
    work,
  );
}
