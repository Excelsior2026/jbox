import { controlQuery } from '@/lib/control-db';
import { isControlDatabaseConfigured } from '@/lib/control-env';

export const dynamic = 'force-dynamic';

/**
 * Bounded readiness only. Deliberately exposes no tenant identifiers or counts
 * — a health endpoint is unauthenticated by nature, so anything it returns is
 * public.
 */
export async function GET() {
  const checks = { database: false, schema: false };

  if (isControlDatabaseConfigured()) {
    try {
      const rows = await controlQuery(
        "SELECT EXISTS (SELECT 1 FROM _migrations WHERE name = $1) AS schema_ready",
        ['006_estimate_customer_snapshot.sql'],
      );
      checks.database = true;
      checks.schema = Boolean(rows[0]?.schema_ready);
    } catch {
      // Leave both false; the status code carries the signal.
    }
  }

  const ok = checks.database && checks.schema;
  return Response.json(
    { ok, service: 'control', checks },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
