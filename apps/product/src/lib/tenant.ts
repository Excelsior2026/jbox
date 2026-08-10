import 'server-only';

import { headers } from 'next/headers';
import { validateConfigDocument, type ConfigV1 } from '@contractor-platform/configuration';
import { db, platformDb } from '@/lib/db';
import { runWithOrganizationContext } from '@/lib/organization-context-store';

/**
 * Hostname is the tenant boundary (foundation-decisions.md). A request arrives
 * at the product app on a `*.usejbox.com` subdomain; the subdomain resolves to
 * an organization through resolve_verified_organization(), and every tenant
 * query for that request runs inside runWithOrganizationContext().
 *
 * Every other hostname is the platform shell: the apex domain, the Field sign-in
 * host, and any deployment hostname. It carries no tenant data.
 */

const TENANT_DOMAIN = '.usejbox.com';

/** Hostnames that are platform surfaces, not tenants. */
const PLATFORM_HOSTS = new Set([
  'usejbox.com',
  'www.usejbox.com',
  'app.usejbox.com',
  'field.usejbox.com',
]);

export class TenantResolutionError extends Error {
  constructor(
    readonly code: 'no-host' | 'platform-host' | 'unverified-host' | 'not-configured',
  ) {
    super(`TenantResolutionError: ${code}`);
    this.name = 'TenantResolutionError';
  }
}

/**
 * The tenant subdomain implied by a Host header, or null for a platform host or
 * a host outside the tenant domain. Ports are stripped; casing normalized.
 */
export function tenantSubdomainFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (PLATFORM_HOSTS.has(hostname)) return null;
  if (hostname.endsWith(TENANT_DOMAIN)) {
    return hostname.slice(0, -TENANT_DOMAIN.length);
  }
  return null;
}

export type TenantContext = {
  organizationId: string;
  subdomain: string;
  hostname: string;
};

/**
 * Resolves the request's tenant and runs `work` inside that tenant's async
 * context. Fails closed: an unverified hostname throws before any tenant query
 * runs.
 */
export async function withTenant<T>(work: (tenant: TenantContext) => Promise<T>): Promise<T> {
  const hostname = (await headers()).get('host') ?? '';
  const subdomain = tenantSubdomainFromHost(hostname);
  if (!subdomain) {
    throw new TenantResolutionError(hostname ? 'platform-host' : 'no-host');
  }

  const rows = await platformDb().query(
    'SELECT resolve_verified_organization($1) AS organization_id',
    [hostname],
  );
  const organizationId = rows[0]?.organization_id;
  if (typeof organizationId !== 'string') {
    throw new TenantResolutionError('unverified-host');
  }

  return runWithOrganizationContext(
    {
      organizationId,
      actorId: null,
      requestId: crypto.randomUUID(),
    },
    () => work({ organizationId, subdomain, hostname }),
  );
}

export type StorefrontData = {
  config: ConfigV1;
  tenant: TenantContext;
};

/**
 * Loads everything a storefront page needs: the resolved tenant and the single
 * approved, in-force configuration document. A tenant with no approved config
 * yet reads as not-configured, so the storefront never renders half a tenant.
 */
export async function loadStorefront(): Promise<StorefrontData> {
  return withTenant(async (tenant) => {
    const rows = await db().query(
      `SELECT document
         FROM configuration_versions
        WHERE status = 'approved'
          AND superseded_at IS NULL
        ORDER BY version DESC
        LIMIT 1`,
      [],
    );
    const raw = rows[0]?.document;
    if (!raw) {
      throw new TenantResolutionError('not-configured');
    }
    return { config: validateConfigDocument(raw), tenant };
  });
}

export function formatCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const centsRemainder = cents % 100;
  return `$${dollars.toLocaleString('en-US')}${centsRemainder ? `.${String(centsRemainder).padStart(2, '0')}` : ''}`;
}
