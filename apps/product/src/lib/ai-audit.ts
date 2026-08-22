import 'server-only';

import { db } from '@/lib/db';
import type { AiToolAuditEvent } from '@contractor-platform/ai/agent';

/**
 * Persists application-level AI governance events. The audit ledger records
 * authorization and execution outcomes, not private model chain-of-thought.
 */
export async function recordAiToolAuditEvent(event: AiToolAuditEvent): Promise<void> {
  const input = event.input && typeof event.input === 'object' && !Array.isArray(event.input)
    ? event.input
    : { value: event.input };

  await db().query(
    `INSERT INTO ai_tool_audit_events
      (organization_id, request_id, actor_id, tool_name, risk, outcome, input, reason)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, $8)`,
    [
      event.organizationId,
      event.requestId,
      event.actorId,
      event.toolName,
      event.risk,
      event.outcome,
      JSON.stringify(input),
      event.reason ?? null,
    ],
  );
}
