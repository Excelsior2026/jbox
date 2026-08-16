import { LATEST_MIGRATION } from '@contractor-platform/database';
import { isDatabaseConfigured, platformDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Bounded readiness only. Deliberately exposes no tenant identifiers, counts,
 * or customer data — a health endpoint is unauthenticated by nature, so
 * anything it returns is public.
 *
 * Uses platformDb() because a health probe arrives with no tenant.
 * LATEST_MIGRATION is imported from @contractor-platform/database so both apps
 * always agree on the expected schema version without hand-rolling the string.
 *
 * deadOutboxMessages: number of outbox messages that have exhausted all
 * retries. A non-zero value means deliveries are being lost and should alert.
 */
export async function GET() {
  const checks: Record<string, boolean | number> = { database: false, schema: false };

  if (isDatabaseConfigured()) {
    try {
      const rows = await platformDb().query(
        `SELECT
           COUNT(*) AS applied_count,
           EXISTS (SELECT 1 FROM _migrations WHERE name = $1) AS latest_applied
         FROM _migrations`,
        [LATEST_MIGRATION],
      );
      checks.database = true;
      checks.schema = Boolean(rows[0]?.latest_applied);
      checks.migrationCount = Number(rows[0]?.applied_count ?? 0);
    } catch {
      // Leave all false; the status code carries the signal.
    }

    // Surface dead outbox messages as an observable metric. This count is
    // intentionally separate from the readiness gate — dead messages do not
    // make the service unhealthy (it can still serve requests), but they do
    // represent lost deliveries that an operator should investigate.
    if (checks.database) {
      try {
        const deadRows = await platformDb().query(
          'SELECT count_dead_outbox_messages() AS dead_count',
          [],
        );
        checks.deadOutboxMessages = Number(deadRows[0]?.dead_count ?? 0);
      } catch {
        // count_dead_outbox_messages is migration 014; skip gracefully if
        // the function does not exist yet on older environments.
      }
    }
  }

  const ok = checks.database && checks.schema;
  return Response.json(
    { ok, service: 'product', checks, latestMigration: LATEST_MIGRATION },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
