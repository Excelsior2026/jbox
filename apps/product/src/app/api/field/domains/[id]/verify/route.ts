import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/field/domains/[id]/verify — verify a custom domain.
 * In the current implementation, this directly marks the domain as verified.
 * A real implementation would check for a DNS TXT record first.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'organization.configure')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Domains unavailable' }, 503);
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return privateJson({ error: 'Invalid domain id' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();

      // Check if domain exists and is not already verified
      const domainRows = await sql.query(
        `SELECT id, hostname, verified FROM organization_domains
         WHERE id = $1`,
        [id],
      );

      if (!domainRows.length) {
        return privateJson({ error: 'Domain not found' }, 404);
      }

      const domain = domainRows[0] as Record<string, unknown>;
      if (domain.verified) {
        return privateJson({ ok: true, verified: true, message: 'Domain is already verified' });
      }

      // Mark as verified
      await sql.query(
        `UPDATE organization_domains
         SET verified = true, verified_at = now()
         WHERE id = $1`,
        [id],
      );

      return privateJson({ ok: true, verified: true });
    });
  } catch (error) {
    console.error('Domain verify failed.', error);
    return privateJson({ error: 'Domain verification failed' }, 500);
  }
}
