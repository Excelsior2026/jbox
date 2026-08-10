import 'server-only';

import { db, platformDb } from '@/lib/db';

export type OutboxMessage = {
  id: string;
  organizationId: string;
  topic: string;
  key: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export async function enqueueOutboxMessage(
  topic: string,
  key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sql = db();
  await sql.query(
    `INSERT INTO transactional_outbox (organization_id, topic, key, payload)
     SELECT app_require_organization_id(), $1, $2, $3::jsonb`,
    [topic, key, JSON.stringify(payload)],
  );
}

/**
 * Claims ready messages through the SECURITY DEFINER window. Runs on the
 * platform client: the drain is a cross-tenant job and platform_runtime has no
 * direct read of the outbox — only the claim window.
 */
export async function claimOutboxMessages(batchSize: number): Promise<OutboxMessage[]> {
  const rows = (await platformDb().query('SELECT * FROM claim_ready_outbox_messages($1)', [
    batchSize,
  ])) as Array<{
    id: string;
    organization_id: string;
    topic: string;
    key: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    topic: row.topic,
    key: row.key,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

export async function finishOutboxMessage(
  id: string,
  succeeded: boolean,
  error: string | null,
): Promise<void> {
  await platformDb().query('SELECT finish_outbox_message($1, $2, $3)', [
    id,
    succeeded,
    error,
  ]);
}
