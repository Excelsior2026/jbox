import { isDatabaseConfigured, platformDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Bounded readiness only. Deliberately exposes no tenant identifiers, counts,
 * or customer data — a health endpoint is unauthenticated by nature, so
 * anything it returns is public.
 *
 * Uses platformDb() because a health probe arrives with no tenant.
 */
export async function GET() {
  const checks = { database: false, schema: false };

  if (isDatabaseConfigured()) {
    try {
      const rows = await platformDb().query(
        "SELECT EXISTS (SELECT 1 FROM _migrations WHERE name = $1) AS schema_ready",
        ['002_customers_and_estimates.sql'],
      );
      checks.database = true;
      checks.schema = Boolean(rows[0]?.schema_ready);
    } catch {
      // Leave both false; the status code carries the signal.
    }
  }

  const ok = checks.database && checks.schema;
  return Response.json(
    { ok, service: 'product', checks },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
