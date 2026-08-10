/**
 * The versioned tenant configuration document.
 *
 * One JSON document per tenant, stored in configuration_versions and immutable
 * once approved (foundation-decisions.md §6). It holds branding and business
 * facts only. It deliberately does NOT hold claims or any approval-gated
 * regulatory language: that system was removed from product scope, and this
 * schema is built to keep it out even if it later returns as a feature.
 *
 * `config-v1` is the current document shape. Changing the shape means a new
 * document version, never a silent reinterpretation of stored documents.
 */
import {
  DEFAULT_PUBLIC_SITE_TEMPLATE_ID,
  PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
  isPublicSiteTemplateId,
  type PublicSiteTemplateId,
} from './templates';

export const CONFIG_DOCUMENT_VERSION = 'config-v1';

export type HexColor = string;

export type BrandPalette = {
  primaryColor: HexColor;
  accentColor: HexColor;
  surfaceColor: HexColor;
};

export type ContactInfo = {
  phone: string;
  email: string;
  address: string;
  hours: string;
};

export type ServiceDefinition = {
  slug: string;
  name: string;
  description: string;
  /** "From $X" shown on the storefront card; null means quote on request. */
  priceFromCents: number | null;
};

export type DocumentPrefixes = {
  customer: string;
  estimate: string;
  serviceRequest: string;
  job: string;
  invoice: string;
  receipt: string;
};

export type ConfigV1 = {
  version: typeof CONFIG_DOCUMENT_VERSION;
  templateId: PublicSiteTemplateId;
  catalogVersion: typeof PUBLIC_SITE_TEMPLATE_CATALOG_VERSION;
  brand: BrandPalette;
  identity: {
    businessName: string;
    tagline: string;
  };
  contact: ContactInfo;
  serviceArea: {
    description: string;
  };
  services: ServiceDefinition[];
  hero: {
    headline: string;
    subheadline: string;
  };
  about: {
    body: string;
  };
  documents: {
    prefixes: DocumentPrefixes;
  };
  tax: {
    taxRateMillipercent: number;
  };
};

export const DEFAULT_BRAND_PALETTE: BrandPalette = {
  primaryColor: '#111827',
  accentColor: '#2563eb',
  surfaceColor: '#ffffff',
};

export const DEFAULT_DOCUMENT_PREFIXES: DocumentPrefixes = {
  customer: 'CUS',
  estimate: 'EST',
  serviceRequest: 'SRQ',
  job: 'JOB',
  invoice: 'INV',
  receipt: 'RCT',
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;

type ValidationProblem = { path: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateString(
  value: unknown,
  path: string,
  { maxLength }: { maxLength: number },
  problems: ValidationProblem[],
): string {
  if (typeof value !== 'string') {
    problems.push({ path, message: 'expected a string' });
    return '';
  }
  if (value.length > maxLength) {
    problems.push({ path, message: `must be at most ${maxLength} characters` });
  }
  return value;
}

/**
 * Validates an untrusted document against the config-v1 shape. Throws with a
 * list of every problem rather than the first one found, so a wizard step that
 * produced several bad fields reports them all at once. Unknown fields are
 * rejected: a field the runtime does not understand today is one it will guess
 * about tomorrow.
 *
 * This checks STRUCTURE only: version, template selection, color/prefix/slug
 * format, and value ranges. Copy fields may be empty here; whether a document
 * has enough substance to show the public is assertApprovalReady's job.
 */
export function validateConfigDocument(document: unknown): ConfigV1 {
  if (!isRecord(document)) {
    throw new Error('Configuration document must be an object.');
  }

  const problems: ValidationProblem[] = [];

  if (document.version !== CONFIG_DOCUMENT_VERSION) {
    problems.push({ path: 'version', message: `must be ${CONFIG_DOCUMENT_VERSION}` });
  }
  if (document.catalogVersion !== PUBLIC_SITE_TEMPLATE_CATALOG_VERSION) {
    problems.push({
      path: 'catalogVersion',
      message: `must be ${PUBLIC_SITE_TEMPLATE_CATALOG_VERSION}`,
    });
  }
  if (!isPublicSiteTemplateId(document.templateId)) {
    problems.push({ path: 'templateId', message: 'is not a template in the catalog' });
  }

  const allowedKeys = new Set([
    'version', 'templateId', 'catalogVersion', 'brand', 'identity', 'contact',
    'serviceArea', 'services', 'hero', 'about', 'documents', 'tax',
  ]);
  for (const key of Object.keys(document)) {
    if (!allowedKeys.has(key)) problems.push({ path: key, message: 'unknown field' });
  }

  const brand = isRecord(document.brand) ? document.brand : {};
  for (const key of ['primaryColor', 'accentColor', 'surfaceColor'] as const) {
    if (typeof brand[key] !== 'string' || !HEX_COLOR_PATTERN.test(brand[key])) {
      problems.push({ path: `brand.${key}`, message: 'must be a hex color like #2563eb' });
    }
  }

  const identity = isRecord(document.identity) ? document.identity : {};
  validateString(identity.businessName, 'identity.businessName', { maxLength: 200 }, problems);
  validateString(identity.tagline, 'identity.tagline', { maxLength: 200 }, problems);

  const contact = isRecord(document.contact) ? document.contact : {};
  validateString(contact.phone, 'contact.phone', { maxLength: 40 }, problems);
  validateString(contact.email, 'contact.email', { maxLength: 320 }, problems);
  validateString(contact.address, 'contact.address', { maxLength: 200 }, problems);
  validateString(contact.hours, 'contact.hours', { maxLength: 100 }, problems);

  const serviceArea = isRecord(document.serviceArea) ? document.serviceArea : {};
  validateString(serviceArea.description, 'serviceArea.description', { maxLength: 300 }, problems);

  if (!Array.isArray(document.services)) {
    problems.push({ path: 'services', message: 'must be an array' });
  } else {
    document.services.forEach((service, index) => {
      if (!isRecord(service)) {
        problems.push({ path: `services[${index}]`, message: 'must be an object' });
        return;
      }
      const path = `services[${index}]`;
      const slug = validateString(service.slug, `${path}.slug`, { maxLength: 40 }, problems);
      validateString(service.name, `${path}.name`, { maxLength: 80 }, problems);
      validateString(service.description, `${path}.description`, { maxLength: 300 }, problems);
      if (slug && !/^[a-z0-9-]+$/.test(slug)) {
        problems.push({ path: `${path}.slug`, message: 'must be lowercase letters, digits, and dashes' });
      }
      const priceFromCents = service.priceFromCents;
      if (priceFromCents !== null && (typeof priceFromCents !== 'number'
          || !Number.isInteger(priceFromCents) || priceFromCents < 0)) {
        problems.push({ path: `${path}.priceFromCents`, message: 'must be a non-negative integer cents or null' });
      }
    });
  }

  const hero = isRecord(document.hero) ? document.hero : {};
  validateString(hero.headline, 'hero.headline', { maxLength: 200 }, problems);
  validateString(hero.subheadline, 'hero.subheadline', { maxLength: 400 }, problems);

  const about = isRecord(document.about) ? document.about : {};
  validateString(about.body, 'about.body', { maxLength: 4000 }, problems);

  const documents = isRecord(document.documents) ? document.documents : {};
  const prefixes = isRecord(documents.prefixes) ? documents.prefixes : {};
  for (const key of ['customer', 'estimate', 'serviceRequest', 'job', 'invoice', 'receipt'] as const) {
    const value = prefixes[key];
    if (typeof value !== 'string' || !PREFIX_PATTERN.test(value)) {
      problems.push({
        path: `documents.prefixes.${key}`,
        message: 'must be uppercase letters/digits like EST',
      });
    }
  }

  const tax = isRecord(document.tax) ? document.tax : {};
  const taxRateMillipercent = tax.taxRateMillipercent;
  if (typeof taxRateMillipercent !== 'number' || !Number.isInteger(taxRateMillipercent)
      || taxRateMillipercent < 0 || taxRateMillipercent > 100000) {
    problems.push({ path: 'tax.taxRateMillipercent', message: 'must be an integer millipercent 0..100000' });
  }

  if (problems.length) {
    const summary = problems
      .map((problem) => `${problem.path}: ${problem.message}`)
      .join('; ');
    throw new Error(`Invalid configuration document (${summary})`);
  }

  return document as unknown as ConfigV1;
}

/**
 * Checks whether a draft is fit to be approved and rendered. validateConfigDocument
 * keeps a draft structurally valid; this is the higher bar that says "a real
 * tenant would show this to the public". Template selection and colors are
 * deliberately NOT checked here — the wizard makes the human choose both, so
 * they are always present; this guards against an empty half-filled draft
 * slipping through.
 */
export function assertApprovalReady(config: ConfigV1): void {
  const problems: string[] = [];
  if (!config.identity.businessName.trim()) problems.push('a business name is required');
  if (!config.services.length) problems.push('at least one service is required');
  if (!config.hero.headline.trim()) problems.push('a hero headline is required');
  if (!config.contact.phone.trim() && !config.contact.email.trim()) {
    problems.push('a phone or email contact is required');
  }
  if (problems.length) {
    throw new Error(`Configuration is not ready to approve: ${problems.join('; ')}`);
  }
}

/**
 * A valid skeleton to start an onboarding draft from: the default template and
 * palette, empty copy fields that the wizard then fills (AI drafts, human
 * approves). Validation always passes on the result.
 */
export function createEmptyConfigDraft(overrides: Partial<ConfigV1> = {}): ConfigV1 {
  const draft: ConfigV1 = {
    version: CONFIG_DOCUMENT_VERSION,
    templateId: DEFAULT_PUBLIC_SITE_TEMPLATE_ID,
    catalogVersion: PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
    brand: { ...DEFAULT_BRAND_PALETTE },
    identity: { businessName: '', tagline: '' },
    contact: { phone: '', email: '', address: '', hours: '' },
    serviceArea: { description: '' },
    services: [],
    hero: { headline: '', subheadline: '' },
    about: { body: '' },
    documents: { prefixes: { ...DEFAULT_DOCUMENT_PREFIXES } },
    tax: { taxRateMillipercent: 0 },
    ...overrides,
  };
  return validateConfigDocument(draft);
}
