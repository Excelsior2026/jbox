export const dynamic = 'force-dynamic';

/**
 * Liveness only. The control plane has no database client yet; once it does,
 * this should assert schema readiness the way the product probe does.
 */
export async function GET() {
  return Response.json(
    { ok: true, service: 'control', checks: { process: true } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
