import 'server-only';

/**
 * CSRF guard for state-changing Field endpoints.
 *
 * The prototype checked the Origin against the tenant's verified hostname; jbox
 * has no verified hostname in context, and Field runs on a platform host
 * (field.usejbox.com) where the API is served from the same origin as the app
 * it protects. So the allowed origin is the request's own origin — the Field
 * app and the Field API share a host, and a cross-site form or fetch cannot
 * claim that origin.
 *
 * Browsers normally send Origin for state-changing requests, but some
 * same-origin fetch implementations omit it. Referer is also browser-controlled
 * and provides an exact-origin fallback for that case. If Origin is present it
 * always wins, so a conflicting Referer cannot override a cross-site source.
 */
export function publicRequestIsSameOrigin(request: Request): boolean {
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;

  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(source).origin;
  } catch {
    return false;
  }

  const requestUrl = new URL(request.url);
  const allowed = new Set<string>([requestUrl.origin]);

  if (process.env.NODE_ENV !== 'production') {
    if (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') {
      const port = requestUrl.port ? `:${requestUrl.port}` : '';
      allowed.add(`${requestUrl.protocol}//localhost${port}`);
      allowed.add(`${requestUrl.protocol}//127.0.0.1${port}`);
    }
  }

  return allowed.has(parsedOrigin);
}
