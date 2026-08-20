import type { NextRequest } from 'next/server';
import { platformDb, isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const VALID_TRADES = new Set(['electrical', 'plumbing', 'hvac', 'general']);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

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

  const slug = slugify(businessName);
  if (!slug || slug.length < 2) {
    return privateJson({ ok: false, error: 'Business name must produce a valid slug' }, 400);
  }

  try {
    const sql = platformDb();

    const rows = await sql.query(
      'SELECT create_organization_with_trade($1, $2, $3) AS org',
      [slug, businessName, tradeCategory],
    );

    const org = rows[0]?.org as { id: string; display_name: string; trade_category: string } | undefined;

    if (!org) {
      return privateJson({ ok: false, error: 'Failed to create organization' }, 500);
    }

    return privateJson({ ok: true, organization: org }, 201);
  } catch (error) {
    console.error('J-Box setup failed:', error);
    return privateJson({ ok: false, error: 'Setup failed' }, 500);
  }
}
