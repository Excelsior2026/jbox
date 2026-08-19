import 'server-only';

import { headers } from 'next/headers';
import { validateConfigDocument, type ConfigV1 } from '@contractor-platform/configuration';
import { db, platformDb } from '@/lib/db';
import { classifyHost, hostnameOf, isPotentialCustomDomain, tenantSubdomainFromHost } from '@/lib/host';
import { runWithOrganizationContext } from '@/lib/organization-context-store';

/**
 * Hostname is the tenant boundary (foundation-decisions.md). A request arrives
 * at the product app on a `*.usejbox.com` subdomain or a custom domain; the
 * hostname resolves to an organization through resolve_verified_organization(),
 * and every tenant query for that request runs inside runWithOrganizationContext().
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
  subdomain: string | null;
  hostname: string;
  isCustomDomain: boolean;
};

/**
 * Resolves the request's tenant and runs `work` inside that tenant's async
 * context. Fails closed: a hostname that is not a verified, active tenant
 * throws before any tenant query runs.
 *
 * Supports both *.usejbox.com subdomains (fast path, no DB needed for
 * classification) and custom domains (requires DB resolution).
 */
export async function withTenant<T>(work: (tenant: TenantContext) => Promise<T>): Promise<T> {
  const host = (await headers()).get('host') ?? '';
  const kind = classifyHost(host);
  const hostname = hostnameOf(host);

  // Platform hosts are never tenants
  if (kind === 'platform') {
    throw new TenantResolutionError('platform-host');
  }

  // Try to get the subdomain for *.usejbox.com hosts
  const subdomain = tenantSubdomainFromHost(host);
  const isCustomDomain = !subdomain && isPotentialCustomDomain(host);

  // For unknown hosts, only proceed if it looks like a custom domain
  if (kind === 'unknown' && !isCustomDomain) {
    throw new TenantResolutionError('no-host');
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
    () => work({ organizationId, subdomain, hostname, isCustomDomain }),
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
  if (!Number.isFinite(cents)) return '$0';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}${remainder ? `.${String(remainder).padStart(2, '0')}` : ''}`;
}
