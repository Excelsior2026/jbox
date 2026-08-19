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
 * DELETE /api/field/domains/[id] — remove a custom domain.
 * Cannot remove the canonical domain.
 */
export async function DELETE(
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

      // Check if this is the canonical domain
      const domainRows = await sql.query(
        `SELECT id, is_canonical FROM organization_domains
         WHERE id = $1`,
        [id],
      );

      if (!domainRows.length) {
        return privateJson({ error: 'Domain not found' }, 404);
      }

      if (domainRows[0].is_canonical) {
        return privateJson({ error: 'Cannot remove the canonical domain' }, 400);
      }

      await sql.query('DELETE FROM organization_domains WHERE id = $1', [id]);

      return privateJson({ ok: true });
    });
  } catch (error) {
    console.error('Domain delete failed.', error);
    return privateJson({ error: 'Domain delete failed' }, 500);
  }
}
