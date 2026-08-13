import 'server-only';

import {
  capabilitiesForRole,
  type ApplicationRole,
  type Capability,
} from '@contractor-platform/domain';
import { readFieldSessionToken, resolveStaffFromToken } from '@/lib/auth';
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
 *   1. getFieldPrincipal() -- first-party session JWT (see lib/auth.ts) ->
 *      live membership. Returns a principal carrying the organization id and
 *      actor id, or null when the request has no usable Field identity.
 *
 *   2. The route wraps its DB work in withFieldContext() using that principal,
 *      so every tenant query runs as contractor_app under the RLS boundary the
 *      principal authenticated for.
 *
 * The JWT carries the organization id, but the organization id is not trusted
 * on its own: every request re-reads the active membership through the
 * staff_session_membership SECURITY DEFINER window (migration 007), so a
 * revoked membership or changed role applies on the next request. Tenant
 * context established here is exactly the boundary the database enforces.
 *
 * Development/demo fallback: when FIELD_DEMO_MODE is explicitly enabled the
 * workspace opens to the configured demo organization with an owner principal.
 * It is the deliberate opt-in that makes the Field UI usable without an
 * identity provider in production — never set it for a tenant that holds real
 * data.
 */

export type FieldPrincipal = {
  kind: 'jwt' | 'development';
  organizationId: string;
  actorId: string | null;
  membershipId: string;
  role: ApplicationRole;
  capabilities: ReadonlySet<Capability>;
  displayName: string | null;
  email: string | null;
};

export async function resolveJwtFieldPrincipal(): Promise<FieldPrincipal | null> {
  const token = await readFieldSessionToken();
  if (!token) return null;

  const staff = await resolveStaffFromToken(token);
  if (!staff) return null;

  return {
    kind: 'jwt',
    organizationId: staff.organizationId,
    actorId: staff.platformUserId,
    membershipId: staff.membershipId,
    role: staff.role,
    capabilities: capabilitiesForRole(staff.role),
    displayName: staff.displayName || null,
    email: staff.email || null,
  };
}

/**
 * Development/demo fallback: when demo mode is explicitly enabled (and only
 * then), resolve the configured demo organization so the Field UI can be
 * explored against a database-backed tenant. There is no real membership in
 * this mode; the organization id comes from the deployment environment rather
 * than a request. FIELD_DEMO_MODE is the deliberate opt-in that opens the
 * workspace to the configured demo organization in production.
 */
export async function resolveDevelopmentFieldPrincipal(): Promise<FieldPrincipal | null> {
  const demoMode = process.env.FIELD_DEMO_MODE === '1';
  if (process.env.NODE_ENV === 'production' && !demoMode) return null;

  const organizationId = process.env.DEVELOPMENT_FIELD_ORGANIZATION_ID?.trim() ?? '';
  if (!organizationId) return null;

  return {
    kind: 'development',
    organizationId,
    actorId: null,
    membershipId: '',
    role: 'owner',
    capabilities: capabilitiesForRole('owner'),
    displayName: null,
    email: null,
  };
}

export async function getFieldPrincipal(): Promise<FieldPrincipal | null> {
  const jwtPrincipal = await resolveJwtFieldPrincipal();
  if (jwtPrincipal) return jwtPrincipal;
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
