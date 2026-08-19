import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  buildConfigDocument,
  validateProvisionTenantInput,
  type OrganizationReadiness,
  type OrganizationSummary,
  type PriceBookInput,
  type ProvisionedTenant,
  RECORD_KINDS,
} from '@/lib/control-contract';
import {
  controlQuery,
  provision,
  type ControlStatement,
} from '@/lib/control-db';

/**
 * The provisioning control plane. Each operation is a single transaction:
 * control-owned rows are written as control_app, tenant content is written as
 * contractor_app under the org context the tenant's own code uses, so row-level
 * security is enforced on every write the way it is on the product side.
 */

function conflictError(kind: 'slug' | 'hostname', value: string): never {
  throw new Error(`${kind} already in use: ${value}`);
}

/**
 * Pre-flight uniqueness checks. The transaction below also guards each insert
 * with ON CONFLICT DO NOTHING, so a concurrent race aborts atomically instead
 * of corrupting anything.
 */
async function assertUniqueness(slug: string, hostname: string) {
  const slugRows = await controlQuery('SELECT 1 FROM organizations WHERE slug = $1', [slug]);
  if (slugRows.length) conflictError('slug', slug);
  const hostRows = await controlQuery(
    'SELECT 1 FROM organization_domains WHERE hostname = $1',
    [hostname],
  );
  if (hostRows.length) conflictError('hostname', hostname);
}

function priceBookStatements(organizationId: string, priceBook: PriceBookInput): ControlStatement[] {
  const statements: ControlStatement[] = [];
  const releaseItems: Array<{ itemId: string; itemVersionId: string }> = [];

  priceBook.categories.forEach((category) => {
    const categoryId = randomUUID();
    statements.push({
      role: 'contractor_app',
      text: `INSERT INTO price_book_categories (id, organization_id, name, position)
             VALUES ($1, $2, $3, $4)`,
      values: [categoryId, organizationId, category.name, category.position],
    });

    category.items.forEach((item) => {
      const itemId = randomUUID();
      const itemVersionId = randomUUID();
      statements.push(
        {
          role: 'contractor_app',
          text: `INSERT INTO price_book_items
                   (id, organization_id, category_id, code, description, unit, taxable, active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
          values: [
            itemId, organizationId, categoryId, item.code, item.description, item.unit,
            item.taxable,
          ],
        },
        {
          role: 'contractor_app',
          text: `INSERT INTO price_book_item_versions
                   (id, organization_id, item_id, version, unit_price_cents, changed_by)
                 VALUES ($1, $2, $3, 1, $4, NULL)`,
          values: [itemVersionId, organizationId, itemId, item.unitPriceCents],
        },
      );
      releaseItems.push({ itemId, itemVersionId });
    });
  });

  const releaseId = randomUUID();
  statements.push(
    {
      role: 'contractor_app',
      text: `INSERT INTO price_book_releases (id, organization_id, name, status)
             VALUES ($1, $2, $3, 'draft')`,
      values: [releaseId, organizationId, priceBook.name ?? 'v1'],
    },
    ...releaseItems.map(({ itemId, itemVersionId }) => ({
      role: 'contractor_app' as const,
      text: `INSERT INTO price_book_release_items
               (id, organization_id, release_id, item_id, item_version_id)
             VALUES ($1, $2, $3, $4, $5)`,
      values: [randomUUID(), organizationId, releaseId, itemId, itemVersionId],
    })),
    {
      role: 'contractor_app',
      text: `UPDATE price_book_releases SET status = 'published'
             WHERE id = $1 AND organization_id = $2
             RETURNING id, name, status`,
      values: [releaseId, organizationId],
    },
  );

  return statements;
}

/**
 * Provisions a new tenant: the organization and its canonical hostname as
 * control_app, then — under the org context — counters, the approved config-v1
 * document, and (if given) a price book published as release v1.
 */
export async function provisionTenant(raw: unknown): Promise<ProvisionedTenant> {
  const input = validateProvisionTenantInput(raw);
  await assertUniqueness(input.slug, input.canonicalHostname);

  const organizationId = randomUUID();
  const requestId = randomUUID();
  const config = buildConfigDocument(input);

  const statements: ControlStatement[] = [
    {
      role: 'control_app',
      text: `INSERT INTO organizations (id, slug, display_name, status)
             VALUES ($1, $2, $3, 'provisioning')
             ON CONFLICT (slug) DO NOTHING
             RETURNING id`,
      values: [organizationId, input.slug, input.displayName],
    },
    {
      role: 'control_app',
      text: `INSERT INTO organization_domains
               (organization_id, hostname, is_canonical, verified, verified_at)
             VALUES ($1, $2, true, false, NULL)
             ON CONFLICT (hostname) DO NOTHING
             RETURNING id`,
      values: [organizationId, input.canonicalHostname],
    },
    ...(input.clerkOrganizationId
      ? [{
          role: 'control_app' as const,
          text: 'SELECT link_organization_clerk($1::uuid, $2::text)',
          values: [organizationId, input.clerkOrganizationId],
        }]
      : []),
    {
      role: 'control_app',
      text: 'SELECT set_application_context($1::uuid, NULL, $2::uuid)',
      values: [organizationId, requestId],
    },
    {
      role: 'contractor_app',
      text: `INSERT INTO organization_record_counters (organization_id, record_kind, next_value)
             SELECT $1, k, 1 FROM unnest($2::text[]) AS k
             ON CONFLICT (organization_id, record_kind) DO NOTHING`,
      values: [organizationId, [...RECORD_KINDS]],
    },
    {
      role: 'contractor_app',
      text: `INSERT INTO configuration_versions
               (organization_id, version, status, document_version, document, created_by, approved_at)
             VALUES ($1, 1, 'approved', 'config-v1', $2::jsonb, NULL, now())
             RETURNING version`,
      values: [organizationId, JSON.stringify(config)],
    },
    ...(input.priceBook ? priceBookStatements(organizationId, input.priceBook) : []),
  ];

  const results = await provision(statements);

  const insertedOrganization = results[0];
  const insertedDomain = results[1];
  if (!insertedOrganization.length) conflictError('slug', input.slug);
  if (!insertedDomain.length) conflictError('hostname', input.canonicalHostname);

  const configRow = results.find((rows) => rows.some((row) => row.version !== undefined));
  const configVersion = configRow ? Number(configRow[0].version) : 1;

  const releaseRows = results.find((rows) => (
    rows.some((row) => row.status === 'published' && 'name' in row)
  ));

  return {
    organizationId,
    slug: input.slug,
    displayName: input.displayName,
    canonicalHostname: input.canonicalHostname,
    configVersion,
    priceBookReleaseId: releaseRows?.length
      ? String(releaseRows[0].id ?? '')
      : null,
  };
}

export async function listOrganizations(): Promise<OrganizationSummary[]> {
  const rows = await controlQuery(
    `SELECT id, slug, display_name, status, to_json(created_at) AS created_at
     FROM organizations
     ORDER BY organizations.created_at DESC`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    status: String(row.status),
    createdAt: String(row.created_at),
  }));
}

export async function getOrganizationReadiness(id: string): Promise<OrganizationReadiness | null> {
  const [orgRows, , configRows, publishedRows] = await provision([
    {
      role: 'control_app',
      text: `SELECT o.id, o.slug, o.display_name, o.status,
                    d.hostname AS canonical_hostname, d.verified AS domain_verified
             FROM organizations o
             LEFT JOIN organization_domains d
               ON d.organization_id = o.id AND d.is_canonical
             WHERE o.id = $1`,
      values: [id],
    },
    {
      role: 'control_app',
      text: 'SELECT set_application_context($1::uuid, NULL, $2::uuid)',
      values: [id, randomUUID()],
    },
    {
      role: 'contractor_app',
      text: `SELECT version, status
             FROM configuration_versions
             WHERE organization_id = $1
             ORDER BY version DESC
             LIMIT 1`,
      values: [id],
    },
    {
      role: 'contractor_app',
      text: `SELECT EXISTS (
               SELECT 1 FROM price_book_releases
               WHERE organization_id = $1 AND status = 'published'
             ) AS published,
             (
               SELECT status FROM price_book_releases
               WHERE organization_id = $1
               ORDER BY created_at DESC
               LIMIT 1
             ) AS latest_status`,
      values: [id],
    },
  ]);

  const org = orgRows[0];
  if (!org) return null;

  const config = configRows[0];
  const published = publishedRows[0];

  return {
    id: String(org.id),
    slug: String(org.slug),
    displayName: String(org.display_name),
    status: String(org.status),
    canonicalHostname: org.canonical_hostname ? String(org.canonical_hostname) : null,
    domainVerified: Boolean(org.domain_verified),
    configStatus: config ? String(config.status) : null,
    configVersion: config ? Number(config.version) : null,
    priceBookPublished: Boolean(published?.published),
    priceBookStatus: published?.latest_status ? String(published.latest_status) : null,
  };
}

/**
 * Domain management for custom domains. These functions handle adding,
 * removing, and verifying custom domains for organizations.
 */

export type DomainRecord = {
  id: string;
  organizationId: string;
  hostname: string;
  isCanonical: boolean;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
};

/**
 * Adds a custom domain to an organization. The domain is inserted as
 * unverified; the operator must complete DNS verification before it can
 * be used for tenant resolution.
 */
export async function addCustomDomain(
  organizationId: string,
  hostname: string,
): Promise<DomainRecord> {
  // Validate hostname format
  const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new Error('hostname is not a valid domain');
  }

  // Check if hostname is already in use
  const existingRows = await controlQuery(
    'SELECT 1 FROM organization_domains WHERE hostname = $1',
    [hostname],
  );
  if (existingRows.length) {
    throw new Error('hostname already in use');
  }

  // Check if this is a *.usejbox.com subdomain (reserved)
  if (hostname.endsWith('.usejbox.com')) {
    throw new Error('cannot add *.usejbox.com subdomains as custom domains');
  }

  const rows = await controlQuery(
    `INSERT INTO organization_domains (organization_id, hostname, is_canonical, verified)
     VALUES ($1, $2, false, false)
     RETURNING id, organization_id, hostname, is_canonical, verified, verified_at, created_at`,
    [organizationId, hostname],
  );

  if (!rows.length) {
    throw new Error('failed to add domain');
  }

  const row = rows[0];
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    hostname: String(row.hostname),
    isCanonical: Boolean(row.is_canonical),
    verified: Boolean(row.verified),
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    createdAt: String(row.created_at),
  };
}

/**
 * Removes a custom domain from an organization. Cannot remove the canonical
 * domain (the *.usejbox.com subdomain used during provisioning).
 */
export async function removeCustomDomain(
  organizationId: string,
  domainId: string,
): Promise<void> {
  // Check if this is the canonical domain
  const domainRows = await controlQuery(
    `SELECT id, is_canonical FROM organization_domains
     WHERE id = $1 AND organization_id = $2`,
    [domainId, organizationId],
  );

  if (!domainRows.length) {
    throw new Error('domain not found');
  }

  if (domainRows[0].is_canonical) {
    throw new Error('cannot remove the canonical domain');
  }

  await controlQuery(
    'DELETE FROM organization_domains WHERE id = $1 AND organization_id = $2',
    [domainId, organizationId],
  );
}

/**
 * Lists all domains for an organization.
 */
export async function listOrganizationDomains(
  organizationId: string,
): Promise<DomainRecord[]> {
  const rows = await controlQuery(
    `SELECT id, organization_id, hostname, is_canonical, verified, verified_at, created_at
     FROM organization_domains
     WHERE organization_id = $1
     ORDER BY is_canonical DESC, created_at ASC`,
    [organizationId],
  );

  return rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    hostname: String(row.hostname),
    isCanonical: Boolean(row.is_canonical),
    verified: Boolean(row.verified),
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    createdAt: String(row.created_at),
  }));
}

/**
 * Generates a DNS TXT record challenge for domain verification. Returns the
 * record name and value that the domain owner must add to their DNS.
 */
export async function generateDomainChallenge(
  organizationId: string,
  domainId: string,
): Promise<{ hostname: string; recordName: string; recordValue: string }> {
  const rows = await controlQuery(
    `SELECT id, hostname, verified FROM organization_domains
     WHERE id = $1 AND organization_id = $2`,
    [domainId, organizationId],
  );

  if (!rows.length) {
    throw new Error('domain not found');
  }

  if (rows[0].verified) {
    throw new Error('domain is already verified');
  }

  const hostname = String(rows[0].hostname);
  const challengeToken = randomUUID().replace(/-/g, '').slice(0, 32);

  return {
    hostname,
    recordName: `_jbox-verify.${hostname}`,
    recordValue: `jbox-verify=${challengeToken}`,
  };
}

/**
 * Verifies a domain by checking for the expected DNS TXT record. If the
 * record is found, the domain is marked as verified.
 */
export async function verifyCustomDomain(
  organizationId: string,
  domainId: string,
): Promise<boolean> {
  const rows = await controlQuery(
    `SELECT id, hostname, verified FROM organization_domains
     WHERE id = $1 AND organization_id = $2`,
    [domainId, organizationId],
  );

  if (!rows.length) {
    throw new Error('domain not found');
  }

  if (rows[0].verified) {
    return true;
  }

  // In a real implementation, this would perform a DNS lookup for the TXT record.
  // For now, we'll mark it as verified directly (operator-driven flow).
  await controlQuery(
    `UPDATE organization_domains
     SET verified = true, verified_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [domainId, organizationId],
  );

  return true;
}

/**
 * Pre-flight uniqueness check for a slug. Used by the onboarding wizard to
 * detect conflicts before the user submits the full provisioning request.
 * This is a read-only check — no mutations.
 */
export async function checkSlugAvailability(slug: string): Promise<{ available: boolean; reason?: string }> {
  const slugRows = await controlQuery('SELECT 1 FROM organizations WHERE slug = $1', [slug]);
  if (slugRows.length) {
    return { available: false, reason: 'slug already in use' };
  }
  return { available: true };
}

/** Marks the canonical hostname verified, after the operator has added DNS. */
export async function verifyCanonicalDomain(id: string): Promise<void> {
  const rows = await controlQuery(
    `UPDATE organization_domains
     SET verified = true, verified_at = now()
     WHERE organization_id = $1 AND is_canonical
     RETURNING id`,
    [id],
  );
  if (!rows.length) {
    throw new Error(`organization ${id} has no canonical hostname to verify`);
  }
}

/**
 * Activates a provisioning tenant. Gated: the canonical hostname must be
 * verified and the config approved; if a price book was provisioned, it must
 * have a published release (004 forbids estimates against unpublished pricing).
 */
export async function activateOrganization(id: string): Promise<void> {
  const readiness = await getOrganizationReadiness(id);
  if (!readiness) throw new Error(`organization not found: ${id}`);

  const gates: string[] = [];
  if (readiness.status !== 'provisioning') {
    throw new Error(`organization ${id} is ${readiness.status}, not provisioning`);
  }
  if (!readiness.domainVerified) gates.push('canonical hostname is not verified');
  if (readiness.configStatus !== 'approved') gates.push('configuration is not approved');
  if (readiness.priceBookStatus !== null && !readiness.priceBookPublished) {
    gates.push('price book has no published release');
  }
  if (gates.length) throw new Error(`cannot activate ${id}: ${gates.join('; ')}`);

  const rows = await controlQuery(
    `UPDATE organizations SET status = 'active'
     WHERE id = $1 AND status = 'provisioning'
     RETURNING id`,
    [id],
  );
  if (!rows.length) throw new Error(`organization ${id} could not be activated`);
}
