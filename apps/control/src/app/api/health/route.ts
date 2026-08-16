import { LATEST_MIGRATION } from '@contractor-platform/database';
import { controlQuery } from '@/lib/control-db';
import { isControlDatabaseConfigured } from '@/lib/control-env';

export const dynamic = 'force-dynamic';

/**
 * Bounded readiness only. Deliberately exposes no tenant identifiers or counts
 * — a health endpoint is unauthenticated by nature, so anything it returns is
 * public.
 *
 * LATEST_MIGRATION is imported from @contractor-platform/database so both apps
 * always agree on the expected schema version without hand-rolling the string.
 */
export async function GET() {
  const checks: Record<string, boolean | number> = { database: false, schema: false };

  if (isControlDatabaseConfigured()) {
    try {
      const rows = await controlQuery(
        `SELECT COUNT(*) AS applied_count,
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
  }

  const ok = checks.database && checks.schema;
  return Response.json(
    { ok, service: 'control', checks, latestMigration: LATEST_MIGRATION },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
