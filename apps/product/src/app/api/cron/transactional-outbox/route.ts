import type { NextRequest } from 'next/server';
import { cronIsAuthorized, cronIsConfigured } from '@/lib/cron-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { logger } from '@/lib/logger';
import { dispatchOutboxMessages } from '@/lib/outbox-dispatch';

export const dynamic = 'force-dynamic';

/**
 * Outbound-platform cron: drains the transactional outbox for every tenant.
 *
 * There is no authenticated user and no Host header, so the route is protected
 * by a shared secret (Authorization: Bearer CRON_SECRET) and runs entirely on
 * the platform client — the claim/finish windows are the outbox's only reach
 * from that position, which is exactly the boundary migration 005 draws.
 */
export async function GET(request: NextRequest) {
  if (!cronIsConfigured()) {
    return privateJson({ ok: false, error: 'Cron unavailable.' }, 503);
  }
  if (!cronIsAuthorized(request.headers.get('authorization'))) {
    return privateJson({ ok: false, error: 'Unauthorized.' }, 401);
  }
  if (!isDatabaseConfigured()) {
    return privateJson({ ok: false, error: 'Database unavailable.' }, 503);
  }

  try {
    const result = await dispatchOutboxMessages();
    logger.info('Outbox drain complete.', result);
    return privateJson({ ok: true, ...result }, 200);
  } catch (err) {
    logger.error('Outbox dispatch failed.', {
      error: err instanceof Error ? err.message : String(err),
    });
    return privateJson({ ok: false, error: 'Dispatch unavailable.' }, 503);
  }
}
