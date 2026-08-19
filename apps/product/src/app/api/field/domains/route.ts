import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * GET /api/field/domains — list all domains for the current organization.
 * Returns the canonical *.usejbox.com domain and any custom domains.
 */
export async function GET() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Domains unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();
      const rows = await sql.query(
        `SELECT id, hostname, is_canonical, verified, verified_at, created_at
         FROM organization_domains
         ORDER BY is_canonical DESC, created_at ASC`,
      );

      const domains = rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        hostname: String(row.hostname),
        isCanonical: Boolean(row.is_canonical),
        verified: Boolean(row.verified),
        verifiedAt: row.verified_at ? String(row.verified_at) : null,
        createdAt: String(row.created_at),
      }));

      return privateJson({ ok: true, domains });
    });
  } catch (error) {
    console.error('Domain list failed.', error);
    return privateJson({ error: 'Domains unavailable' }, 503);
  }
}

/**
 * POST /api/field/domains — add a custom domain to the current organization.
 * Body: { "hostname": "smithplumbing.com" }
 */
export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Domains unavailable' }, 503);
  }

  let body: { hostname?: unknown };
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'request body must be JSON' }, 400);
  }

  if (typeof body.hostname !== 'string' || !body.hostname.trim()) {
    return privateJson({ error: 'hostname is required' }, 400);
  }

  const hostname = body.hostname.trim().toLowerCase();

  // Validate hostname format
  if (!HOSTNAME_PATTERN.test(hostname)) {
    return privateJson({ error: 'hostname is not a valid domain' }, 400);
  }

  // Check if this is a *.usejbox.com subdomain (reserved)
  if (hostname.endsWith('.usejbox.com')) {
    return privateJson({ error: 'cannot add *.usejbox.com subdomains as custom domains' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();

      // Check if hostname is already in use
      const existingRows = await sql.query(
        'SELECT 1 FROM organization_domains WHERE hostname = $1',
        [hostname],
      );

      if (existingRows.length) {
        return privateJson({ error: 'hostname already in use' }, 409);
      }

      // Add the domain
      const rows = await sql.query(
        `INSERT INTO organization_domains (organization_id, hostname, is_canonical, verified)
         VALUES (app_require_organization_id(), $1, false, false)
         RETURNING id, hostname, is_canonical, verified, verified_at, created_at`,
        [hostname],
      );

      if (!rows.length) {
        return privateJson({ error: 'failed to add domain' }, 500);
      }

      const row = rows[0] as Record<string, unknown>;
      return privateJson({
        ok: true,
        domain: {
          id: String(row.id),
          hostname: String(row.hostname),
          isCanonical: Boolean(row.is_canonical),
          verified: Boolean(row.verified),
          verifiedAt: row.verified_at ? String(row.verified_at) : null,
          createdAt: String(row.created_at),
        },
      }, 201);
    });
  } catch (error) {
    console.error('Domain add failed.', error);
    return privateJson({ error: 'Domain add failed' }, 500);
  }
}
