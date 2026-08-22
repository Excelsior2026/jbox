import type {
  AiActorContext,
  AiToolAuditEvent,
  AiToolCall,
  AiToolDefinition,
} from './types';

export class AiToolRegistry {
  private readonly tools = new Map<string, AiToolDefinition<unknown, unknown>>();

  register<TInput, TResult>(tool: AiToolDefinition<TInput, TResult>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`AI tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as AiToolDefinition<unknown, unknown>);
  }

  get(name: string): AiToolDefinition<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): Array<Pick<AiToolDefinition<unknown, unknown>, 'name' | 'description' | 'risk' | 'requiresConfirmation'>> {
    return [...this.tools.values()].map(({ name, description, risk, requiresConfirmation }) => ({
      name,
      description,
      risk,
      requiresConfirmation,
    }));
  }

  async invoke(
    context: AiActorContext,
    call: AiToolCall,
    options: {
      confirm?: boolean;
      audit?: (event: AiToolAuditEvent) => Promise<void> | void;
    } = {},
  ): Promise<unknown> {
    const tool = this.tools.get(call.toolName);
    if (!tool) {
      throw new Error(`Unknown AI tool: ${call.toolName}`);
    }

    const audit = options.audit;
    const base = {
      requestId: context.requestId,
      organizationId: context.organizationId,
      actorId: context.actorId,
      source: context.source,
      toolName: tool.name,
      risk: tool.risk,
      input: call.input,
      createdAt: new Date().toISOString(),
    } as const;

    const authorization = tool.authorize(context, call.input);
    if (!authorization.allowed) {
      await audit?.({ ...base, outcome: 'denied', reason: authorization.reason });
      throw new Error(`AI tool denied: ${authorization.reason}`);
    }

    await audit?.({ ...base, outcome: 'authorized' });

    if (tool.requiresConfirmation && !options.confirm) {
      await audit?.({ ...base, outcome: 'confirmation_required' });
      throw new Error(`Confirmation required for AI tool: ${tool.name}`);
    }

    try {
      const result = await tool.execute(context, call.input);
      await audit?.({ ...base, outcome: 'executed' });
      return result;
    } catch (error) {
      await audit?.({
        ...base,
        outcome: 'failed',
        reason: error instanceof Error ? error.message : 'Unknown tool execution error',
      });
      throw error;
    }
  }
}
