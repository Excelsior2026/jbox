/**
 * Host classification: which hostname is a tenant storefront, which is a
 * platform surface, and which is neither. Pure string logic with no I/O, so
 * the proxy layer and the tenant resolver can share it and it stays unit
 * testable without a database.
 *
 * Security note: suffix matching is anchored on the full label — a hostname
 * like `paris.usejbox.com.evil.com` never matches, and `usejbox.com` itself is
 * never treated as a tenant subdomain.
 */

export const TENANT_DOMAIN = '.usejbox.com';

/** Hostnames that are platform surfaces, not tenants. */
export const PLATFORM_HOSTS = new Set([
  'usejbox.com',
  'www.usejbox.com',
  'app.usejbox.com',
  'field.usejbox.com',
  // Local development — classifyHost returns 'unknown' without this, which
  // causes withTenant() to throw 'no-host' on every dev request.
  'localhost',
  '127.0.0.1',
]);

export type HostKind = 'tenant' | 'platform' | 'unknown';

/** Normalizes a Host header value: strips any port and lowercases. */
export function hostnameOf(host: string | null | undefined): string {
  return (host ?? '').split(':')[0].toLowerCase();
}

/**
 * The tenant subdomain implied by a Host header, or null for a platform host or
 * a host outside the tenant domain.
 */
export function tenantSubdomainFromHost(host: string | null | undefined): string | null {
  const hostname = hostnameOf(host);
  if (!hostname || PLATFORM_HOSTS.has(hostname)) return null;
  if (hostname.endsWith(TENANT_DOMAIN)) {
    return hostname.slice(0, -TENANT_DOMAIN.length);
  }
  return null;
}

export function classifyHost(host: string | null | undefined): HostKind {
  if (!host) return 'unknown';
  const hostname = hostnameOf(host);
  if (PLATFORM_HOSTS.has(hostname)) return 'platform';
  // *.usejbox.com subdomains are always tenants (fast path, no DB needed)
  if (tenantSubdomainFromHost(host)) return 'tenant';
  // Custom domains need DB resolution — return 'unknown' and let withTenant()
  // attempt resolution via resolve_verified_organization()
  return 'unknown';
}

/**
 * Returns true if the hostname could be a custom domain (not a platform host,
 * not a *.usejbox.com subdomain). Used by withTenant() to attempt DB resolution.
 */
export function isPotentialCustomDomain(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = hostnameOf(host);
  if (PLATFORM_HOSTS.has(hostname)) return false;
  if (hostname.endsWith(TENANT_DOMAIN)) return false;
  // Must be a valid-looking hostname (has a dot, at least)
  return hostname.includes('.');
}
