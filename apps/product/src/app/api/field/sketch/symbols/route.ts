import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Sketch symbols unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();

      const orgRows = await sql.query(
        'SELECT trade_category FROM organizations WHERE id = $1',
        [principal.organizationId],
      );
      const organization = orgRows[0];
      const tradeCategory = organization?.trade_category || 'general';

      const palette = await sql.query(
        `SELECT
           csd.id            AS symbol_id,
           csd.category,
           COALESCE(tcs.custom_label, csd.display_name) AS display_name,
           csd.icon_svg_path,
           tcs.price_book_item_id,
           pbi.description   AS price_book_name,
           pbiv.unit_price_cents
         FROM canvas_symbol_definitions csd
         LEFT JOIN tenant_canvas_symbols tcs
           ON csd.id = tcs.symbol_id AND tcs.organization_id = $1
         LEFT JOIN price_book_items pbi
           ON tcs.price_book_item_id = pbi.id
         LEFT JOIN LATERAL (
           SELECT unit_price_cents
           FROM price_book_item_versions pbiv
           WHERE pbiv.item_id = pbi.id
           ORDER BY version DESC
           LIMIT 1
         ) pbiv ON true
         WHERE csd.trade_category = $2
            OR csd.trade_category = 'general'
         ORDER BY csd.category, display_name ASC`,
        [principal.organizationId, tradeCategory],
      );

      return privateJson({
        organizationId: principal.organizationId,
        tradeCategory,
        palette,
      });
    });
  } catch (error) {
    console.error('Failed to fetch sketch canvas symbols:', error);
    return privateJson({ error: 'Failed to load sketch symbols' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Sketch symbols unavailable' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid body' }, 400);
  }

  const symbolId = typeof body.symbolId === 'string' ? body.symbolId : null;
  const customLabel = typeof body.customLabel === 'string' ? body.customLabel : null;
  const priceBookItemId = typeof body.priceBookItemId === 'string' ? body.priceBookItemId : null;

  if (!symbolId) {
    return privateJson({ error: 'symbolId is required' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();

      const rows = await sql.query(
        `INSERT INTO tenant_canvas_symbols (
           organization_id, symbol_id, custom_label, price_book_item_id, is_active
         ) VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (organization_id, symbol_id)
         DO UPDATE SET
           custom_label     = EXCLUDED.custom_label,
           price_book_item_id = EXCLUDED.price_book_item_id
         RETURNING *`,
        [principal.organizationId, symbolId, customLabel, priceBookItemId],
      );

      return privateJson({ success: true, symbolMapping: rows[0] });
    });
  } catch (error) {
    console.error('Failed to update symbol price book link:', error);
    return privateJson({ error: 'Failed to bind symbol' }, 503);
  }
}
