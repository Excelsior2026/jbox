import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const VALID_TRADES = new Set(['electrical', 'plumbing', 'hvac', 'general']);

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
  const tradeCategory = typeof body.tradeCategory === 'string' ? body.tradeCategory : '';

  if (!businessName || businessName.length > 200) {
    return privateJson({ ok: false, error: 'Business name is required (max 200 chars)' }, 400);
  }

  if (!VALID_TRADES.has(tradeCategory)) {
    return privateJson({ ok: false, error: 'Invalid trade category' }, 400);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ ok: false, error: 'Database not configured' }, 503);
  }

  try {
    const sql = db();

    const orgResult = await sql.transaction([
      sql.query(
        `INSERT INTO organizations (slug, display_name, trade_category, status, created_at, updated_at)
         VALUES (
           lower(regexp_replace($1, '[^a-z0-9]+', '-', 'gi')),
           $2,
           $3,
           'active',
           now(),
           now()
         )
         ON CONFLICT (slug) DO UPDATE
           SET trade_category = EXCLUDED.trade_category, updated_at = now()
         RETURNING id, display_name, trade_category`,
        [businessName, businessName, tradeCategory],
      ),
    ]);

    const org = orgResult[0]?.[0] as { id: string; display_name: string; trade_category: string } | undefined;

    if (!org) {
      return privateJson({ ok: false, error: 'Failed to create organization' }, 500);
    }

    await sql.query(
      `INSERT INTO tenant_canvas_symbols (organization_id, symbol_id, is_active)
       SELECT $1, id, true
       FROM canvas_symbol_definitions
       WHERE trade_category = $2 OR trade_category = 'general'
       ON CONFLICT (organization_id, symbol_id) DO NOTHING`,
      [org.id, org.trade_category],
    );

    return privateJson({ ok: true, organization: org }, 201);
  } catch (error) {
    console.error('J-Box setup failed:', error);
    return privateJson({ ok: false, error: 'Setup failed' }, 500);
  }
}
