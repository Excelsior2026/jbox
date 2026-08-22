export type AiActorRole = 'operator' | 'manager' | 'owner';

export type AiActorContext = {
  requestId: string;
  organizationId: string;
  /** Persistent UUID of the AI actor in the application's identity authority. */
  actorId: string;
  /** Stable namespaced identity, e.g. ai:assistant:jbox. */
  actorKey: string;
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
  actorKey: string;
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
