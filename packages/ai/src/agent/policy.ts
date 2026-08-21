import type { AiActorContext, AiRiskLevel, AuthorizationResult } from './types';

const roleRank: Record<AiActorContext['role'], number> = {
  employee: 1,
  manager: 2,
  owner: 3,
};

export function authorizeRisk(
  context: AiActorContext,
  risk: AiRiskLevel,
): AuthorizationResult {
  if (!context.organizationId || !context.actorId || !context.requestId) {
    return { allowed: false, reason: 'Incomplete actor authorization context' };
  }

  // Reads are available to every authenticated JBox role.
  if (risk === 'read') return { allowed: true };

  // Mutating and financially consequential actions require at least manager
  // privileges. Individual tools may impose stricter requirements.
  if (roleRank[context.role] < roleRank.manager) {
    return { allowed: false, reason: `${risk} AI actions require manager privileges` };
  }

  if (risk === 'destructive' && context.role !== 'owner') {
    return { allowed: false, reason: 'Destructive AI actions require owner privileges' };
  }

  return { allowed: true };
}
