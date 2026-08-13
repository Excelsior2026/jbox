import 'server-only';

import {
  CONFIG_DOCUMENT_VERSION,
  PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
  assertApprovalReady,
  isPublicSiteTemplateId,
  validateConfigDocument,
  type ConfigV1,
  type PublicSiteTemplateId,
  type ServiceDefinition,
} from '@contractor-platform/configuration';

/**
 * Contract for provisioning a new tenant through the control plane. The input
 * is validated here before any statement is issued, so a malformed request
 * fails in the API layer with a legible message instead of inside a half-open
 * database transaction.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PRICE_BOOK_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,39}$/;
const UNIT_PATTERN = /^[a-z]{1,8}$/;

export type PriceBookItemInput = {
  code: string;
  description: string;
  unit?: string;
  taxable?: boolean;
  unitPriceCents: number;
};

export type PriceBookCategoryInput = {
  name: string;
  position?: number;
  items: PriceBookItemInput[];
};

export type PriceBookInput = {
  name?: string;
  categories: PriceBookCategoryInput[];
};

export type ProvisionTenantInput = {
  slug: string;
  displayName: string;
  canonicalHostname: string;
  /** Optional Clerk organization id, linked when identity is wired up. */
  clerkOrganizationId?: string;
  templateId?: PublicSiteTemplateId;
  config: Omit<ConfigV1, 'version' | 'templateId' | 'catalogVersion'>;
  priceBook?: PriceBookInput | null;
};

export type ProvisionedTenant = {
  organizationId: string;
  slug: string;
  displayName: string;
  canonicalHostname: string;
  configVersion: number;
  priceBookReleaseId: string | null;
};

export type OrganizationSummary = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  createdAt: string;
};

export type OrganizationReadiness = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  canonicalHostname: string | null;
  domainVerified: boolean;
  configStatus: string | null;
  configVersion: number | null;
  priceBookPublished: boolean;
  priceBookStatus: string | null;
};

class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, path: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ContractError(`${path} must match ${pattern}`);
  }
  return value;
}

/**
 * Builds the immutable config-v1 document from the onboarding input. The
 * document is validated against the same shape the storefront renders, then
 * checked for approval readiness so a tenant cannot be provisioned with an
 * empty draft.
 */
export function buildConfigDocument(input: ProvisionTenantInput): ConfigV1 {
  const templateId: PublicSiteTemplateId = input.templateId ?? 'heritage-craft';
  if (!isPublicSiteTemplateId(templateId)) {
    throw new ContractError('templateId is not a template in the catalog');
  }

  const document = validateConfigDocument({
    ...input.config,
    version: CONFIG_DOCUMENT_VERSION,
    templateId,
    catalogVersion: PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
  });

  assertApprovalReady(document);
  return document;
}

/**
 * Validates the provisioning input end to end and returns the parsed shape.
 * Every check here mirrors a database constraint or a config-v1 rule, so the
 * only failures that can reach the transaction are uniqueness violations
 * (slug/hostname already taken).
 */
export function validateProvisionTenantInput(raw: unknown): ProvisionTenantInput {
  if (!isRecord(raw)) throw new ContractError('request body must be an object');

  const slug = requireString(raw.slug, 'slug', SLUG_PATTERN);
  if (slug.length > 63) throw new ContractError('slug must be at most 63 characters');

  const displayName = raw.displayName;
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 200) {
    throw new ContractError('displayName is required and must be at most 200 characters');
  }

  const canonicalHostname = typeof raw.canonicalHostname === 'string'
    ? raw.canonicalHostname.trim().toLowerCase()
    : '';
  if (!HOSTNAME_PATTERN.test(canonicalHostname)) {
    throw new ContractError('canonicalHostname is not a valid hostname');
  }

  const clerkOrganizationId = raw.clerkOrganizationId;
  if (
    clerkOrganizationId !== undefined
    && (typeof clerkOrganizationId !== 'string' || !clerkOrganizationId.trim())
  ) {
    throw new ContractError('clerkOrganizationId, if present, must be a non-empty string');
  }

  if (!isRecord(raw.config)) throw new ContractError('config must be an object');

  const templateId = raw.templateId;
  if (templateId !== undefined && !isPublicSiteTemplateId(templateId)) {
    throw new ContractError('templateId is not a template in the catalog');
  }

  const priceBook = validatePriceBook(raw.priceBook);

  return {
    slug,
    displayName: displayName.trim(),
    canonicalHostname,
    clerkOrganizationId,
    templateId: templateId as PublicSiteTemplateId | undefined,
    config: raw.config as ProvisionTenantInput['config'],
    priceBook,
  };
}

function validatePriceBook(raw: unknown): PriceBookInput | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw new ContractError('priceBook must be an object');

  const name = raw.name;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 100)) {
    throw new ContractError('priceBook.name must be at most 100 characters');
  }

  const rawCategories = raw.categories;
  if (!Array.isArray(rawCategories) || rawCategories.length === 0) {
    throw new ContractError('priceBook.categories must be a non-empty array');
  }

  const categories: PriceBookCategoryInput[] = rawCategories.map((rawCategory, categoryIndex) => {
    if (!isRecord(rawCategory)) throw new ContractError('priceBook categories must be objects');
    const path = `priceBook.categories[${categoryIndex}]`;

    const categoryName = rawCategory.name;
    if (typeof categoryName !== 'string' || !categoryName.trim() || categoryName.length > 100) {
      throw new ContractError(`${path}.name is required and must be at most 100 characters`);
    }

    const position = rawCategory.position ?? 0;
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
      throw new ContractError(`${path}.position must be a non-negative integer`);
    }

    const rawItems = rawCategory.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new ContractError(`${path}.items must be a non-empty array`);
    }

    const items: PriceBookItemInput[] = rawItems.map((rawItem, itemIndex) => {
      if (!isRecord(rawItem)) throw new ContractError(`${path} items must be objects`);
      const itemPath = `${path}.items[${itemIndex}]`;

      const code = requireString(rawItem.code, `${itemPath}.code`, PRICE_BOOK_CODE_PATTERN);
      const description = rawItem.description;
      if (
        typeof description !== 'string' || !description.trim() || description.length > 300
      ) {
        throw new ContractError(`${itemPath}.description is required and must be at most 300 characters`);
      }

      const unit = rawItem.unit ?? 'ea';
      if (typeof unit !== 'string' || !UNIT_PATTERN.test(unit)) {
        throw new ContractError(`${itemPath}.unit must be lowercase letters like ea or ft`);
      }

      const taxable = rawItem.taxable ?? true;
      if (typeof taxable !== 'boolean') {
        throw new ContractError(`${itemPath}.taxable must be a boolean`);
      }

      const unitPriceCents = rawItem.unitPriceCents;
      if (typeof unitPriceCents !== 'number' || !Number.isInteger(unitPriceCents)
          || unitPriceCents < 0) {
        throw new ContractError(`${itemPath}.unitPriceCents must be a non-negative integer`);
      }

      return { code, description, unit, taxable, unitPriceCents };
    });

    return { name: categoryName.trim(), position, items };
  });

  return { name: name ?? undefined, categories };
}

export { ContractError, isRecord, requireString };

/**
 * The record kinds a tenant may need counter rows for. Seeding them at
 * provisioning pins the first document number at 1 without relying on the
 * lazy insert in allocate_document_number.
 */
export const RECORD_KINDS = ['customer', 'estimate', 'job', 'invoice', 'receipt'] as const;

export type { ServiceDefinition };
