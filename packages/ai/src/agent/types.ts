export type AiActorRole = 'owner' | 'manager' | 'employee';

export type AiActorContext = {
  requestId: string;
  organizationId: string;
  actorId: string;
  role: AiActorRole;
  source: 'human' | 'ai';
  conversationId?: string;
};

export type AiRiskLevel = 'read' | 'write' | 'financial' | 'destructive';

export type AuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export type AiToolCall<TInput = unknown> = {
  toolName: string;
  input: TInput;
};

export type AiToolAuditEvent = {
  requestId: string;
  organizationId: string;
  actorId: string;
  source: AiActorContext['source'];
  toolName: string;
  risk: AiRiskLevel;
  input: unknown;
  outcome: 'authorized' | 'denied' | 'confirmation_required' | 'executed' | 'failed';
  reason?: string;
  createdAt: string;
};

export type AiToolDefinition<TInput, TResult> = {
  name: string;
  description: string;
  risk: AiRiskLevel;
  requiresConfirmation: boolean;
  authorize: (
    context: AiActorContext,
    input: TInput,
  ) => AuthorizationResult;
  execute: (
    context: AiActorContext,
    input: TInput,
  ) => Promise<TResult>;
};
