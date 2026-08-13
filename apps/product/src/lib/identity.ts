import 'server-only';

import type { ApplicationRole } from '@contractor-platform/domain';

/**
 * Native Field identity helpers. The J-Box application role is stored directly
 * on the organization membership ('owner' | 'office' | 'technician'); there is
 * no third-party role to map. This module keeps the role vocabulary in one
 * place so the schema CHECK, the token claims, and the capability model cannot
 * drift apart.
 */

export const APPLICATION_ROLES: readonly ApplicationRole[] = ['owner', 'office', 'technician'];

export function isApplicationRole(value: unknown): value is ApplicationRole {
  return typeof value === 'string' && (APPLICATION_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<ApplicationRole, string> = {
  owner: 'Owner',
  office: 'Office',
  technician: 'Technician',
};
