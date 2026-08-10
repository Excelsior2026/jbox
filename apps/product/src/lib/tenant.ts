import 'server-only';

import { headers } from 'next/headers';
import { validateConfigDocument, type ConfigV1 } from '@contractor-platform/configuration';
import { db, platformDb } from '@/lib/db';
import { classifyHost, hostnameOf, tenantSubdomainFromHost } from '@/lib/host';
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

export class TenantResolutionError extends Error {
  constructor(
    readonly code: 'no-host' | 'platform-host' | 'unverified-host' | 'not-configured',
  ) {
    super(`TenantResolutionError: ${code}`);
    this.name = 'TenantResolutionError';
  }
}

export type TenantContext = {
  organizationId: string;
  subdomain: string;
  hostname: string;
};

/**
 * Resolves the request's tenant and runs `work` inside that tenant's async
 * context. Fails closed: a hostname that is not a verified, active tenant
 * throws before any tenant query runs.
 */
export async function withTenant<T>(work: (tenant: TenantContext) => Promise<T>): Promise<T> {
  const host = (await headers()).get('host') ?? '';
  const kind = classifyHost(host);
  if (kind !== 'tenant') {
    throw new TenantResolutionError(kind === 'platform' ? 'platform-host' : 'no-host');
  }
  const subdomain = tenantSubdomainFromHost(host)!;

  const rows = await platformDb().query(
    'SELECT resolve_verified_organization($1) AS organization_id',
    [hostnameOf(host)],
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
    () => work({ organizationId, subdomain, hostname: hostnameOf(host) }),
  );
}

export type StorefrontData = {
  config: ConfigV1;
  tenant: TenantContext;
};

/**
 * The single approved, in-force configuration document for the current tenant.
 * Requires tenant context (run inside withTenant). Returns null when no
 * approved document is in force yet.
 */
export async function loadInForceConfig(): Promise<ConfigV1 | null> {
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
  return raw ? validateConfigDocument(raw) : null;
}

/**
 * Loads everything a storefront page needs: the resolved tenant and the single
 * approved, in-force configuration document. A tenant with no approved config
 * yet reads as not-configured, so the storefront never renders half a tenant.
 */
export async function loadStorefront(): Promise<StorefrontData> {
  return withTenant(async (tenant) => {
    const config = await loadInForceConfig();
    if (!config) {
      throw new TenantResolutionError('not-configured');
    }
    return { config, tenant };
  });
}

export function formatCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const centsRemainder = cents % 100;
  return `$${dollars.toLocaleString('en-US')}${centsRemainder ? `.${String(centsRemainder).padStart(2, '0')}` : ''}`;
}
