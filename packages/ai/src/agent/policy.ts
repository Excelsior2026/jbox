import type { AiActorContext, AiRiskLevel, AuthorizationResult } from './types';

const roleRank: Record<AiActorContext['role'], number> = {
  operator: 1,
  manager: 2,
  owner: 3,
};

export function authorizeRisk(
  context: AiActorContext,
  risk: AiRiskLevel,
): AuthorizationResult {
  if (!context.organizationId || !context.actorId || !context.actorKey || !context.requestId) {
    return { allowed: false, reason: 'Incomplete actor authorization context' };
  }

  if (risk === 'read') return { allowed: true };

  if (roleRank[context.role] < roleRank.manager) {
    return { allowed: false, reason: `${risk} AI actions require manager authority` };
  }

  if (risk === 'destructive' && context.role !== 'owner') {
    return { allowed: false, reason: 'Destructive AI actions require owner authority' };
  }

  return { allowed: true };
}
