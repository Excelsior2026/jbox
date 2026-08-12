import 'server-only';

/**
 * Shared response helpers for private endpoints (Field API, webhooks, cron).
 *
 * Every response here is un-cacheable and un-indexable: the body carries
 * tenant data, so it must never be cached by a shared cache, and search engines
 * must never learn its URL schema.
 */

export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
} as const;

export function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

export function privateText(body: string, status = 200): Response {
  return new Response(body, { status, headers: PRIVATE_HEADERS });
}
