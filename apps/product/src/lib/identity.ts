import 'server-only';

import type { ApplicationRole } from '@contractor-platform/domain';

/**
 * Maps a Clerk organization role onto a J-Box application role.
 *
 * Clerk's default org roles are org:owner and org:member. J-Box admits a
 * middle tier (office) between owner and technician, so the mapping is explicit
 * and rejects unknown roles: the webhook handler must never invent a role the
 * schema does not understand.
 */
export function applicationRoleForClerkRole(
  role: string | null,
): ApplicationRole | null {
  switch (role) {
    case 'org:owner':
    case 'org:admin':
      return 'owner';
    case 'org:office':
      return 'office';
    case 'org:technician':
    case 'org:member':
      return 'technician';
    default:
      return null;
  }
}

/**
 * True when the session has a positive factor verification age for both the
 * session and the organization membership, which Clerk only reports for
 * MFA-verified sessions.
 */
export function sessionSatisfiesMfa(
  factorVerificationAge: [number, number] | null,
): boolean {
  return Boolean(
    factorVerificationAge
    && factorVerificationAge[0] >= 0
    && factorVerificationAge[1] >= 0,
  );
}
