import 'server-only';

import {
  draftStorefrontCopy,
  mergeStorefrontDraft,
  validateAiDraft,
  type AiStorefrontDraft,
} from '@contractor-platform/ai';
import {
  assertApprovalReady,
  createEmptyConfigDraft,
  isPublicSiteTemplateId,
  type ConfigV1,
  type PublicSiteTemplateId,
} from '@contractor-platform/configuration';

/**
 * The self-serve onboarding path (usejbox.com → /onboarding).
 *
 * Division of labor (foundation decision, see packages/ai): the model drafts
 * COPY only — tagline, hero, about, service area, services. Brand, tax, and
 * prefixes come from safe defaults the wizard owns. The signup ends by calling
 * the control plane, which is the only component that writes organizations.
 * Nothing here touches the product database directly.
 */

export class OnboardingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'OnboardingError';
  }
}

export type OnboardingDraftInput = {
  businessName: string;
  town: string;
  trade: string;
  notes?: string;
};

export type ProvisionContract = {
  slug: string;
  displayName: string;
  canonicalHostname: string;
  templateId: PublicSiteTemplateId;
  config: Omit<ConfigV1, 'version' | 'templateId' | 'catalogVersion'>;
};

export type OnboardingSubmitInput = {
  businessName: string;
  town: string;
  trade: string;
  notes?: string;
  phone: string;
  email: string;
  address?: string;
  hours?: string;
  taxRateMillipercent?: number;
  templateId?: string;
  /** The copy the human confirmed on the preview step. Re-validated here. */
  draft: unknown;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True when the config has enough substance to show the public. */
function isApprovalReady(config: ConfigV1): boolean {
  try {
    assertApprovalReady(config);
    return true;
  } catch {
    return false;
  }
}

function requiredString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new OnboardingError(`${path} is required and must be at most ${maxLength} characters`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string, maxLength: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new OnboardingError(`${path} must be at most ${maxLength} characters`);
  }
  return value.trim();
}

/** URL-safe slug from a business name; never empty. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    || 'tenant'
  );
}

/**
 * Per-tenant document prefixes derived from the business name initials, e.g.
 * "Paris Electric" → PE for every document kind. Falls back to the platform
 * default when the initials are not a valid prefix. Prefixes only distinguish
 * display ids; uniqueness never depends on them (foundation-decisions §1).
 */
export function derivePrefixes(businessName: string): ConfigV1['documents']['prefixes'] {
  let initials = '';
  for (const word of businessName.trim().split(/\s+/)) {
    const first = word.match(/[A-Za-z0-9]/);
    if (!first) continue;
    initials += first[0].toUpperCase();
    if (initials.length >= 3) break;
  }
  const base = /^[A-Z][A-Z0-9]{0,9}$/.test(initials) ? initials : 'JB';
  return {
    customer: `${base}C`,
    estimate: `${base}E`,
    serviceRequest: `${base}S`,
    job: `${base}J`,
    invoice: `${base}I`,
    receipt: `${base}R`,
  };
}

/**
 * Deterministic template draft used when the model cannot be reached. Same
 * shape as an AI draft, plain and local in tone, so the wizard and the preview
 * do not care whether the copy came from the model or from here.
 */
export function fallbackStorefrontDraft(input: OnboardingDraftInput): AiStorefrontDraft {
  const trade = input.trade.trim() || 'service';
  const town = input.town.trim() || 'your area';
  const businessName = input.businessName.trim();
  return {
    tagline: `${businessName} — trusted ${trade} in ${town}`,
    hero: {
      headline: `Reliable ${trade} in ${town}`,
      subheadline:
        `${businessName} handles repairs, installations, and projects with clear `
        + 'quotes and work we stand behind.',
    },
    about: {
      body:
        `${businessName} is a local ${trade} serving ${town} and the surrounding `
        + 'area. We quote clearly, show up when we say we will, and finish the job '
        + 'right.'
        + (input.notes ? ` ${input.notes.trim()}` : ''),
    },
    serviceArea: { description: `Serving ${town} and nearby communities.` },
    services: [
      {
        slug: 'repairs',
        name: 'Repairs',
        description: 'Diagnosis and repair of common problems, with a clear quote before work begins.',
      },
      {
        slug: 'installations',
        name: 'Installations & upgrades',
        description: 'New work, replacements, and upgrades, planned and priced up front.',
      },
      {
        slug: 'emergency',
        name: 'Emergency service',
        description: 'Priority call-outs when something cannot wait for a routine appointment.',
      },
    ],
  };
}

/**
 * Live AI draft when NVIDIA_API_KEY is configured, template draft otherwise.
 * A real model failure also degrades to the template draft — the signup flow
 * must never dead-end on a third-party outage.
 */
export async function draftStorefrontFor(
  input: OnboardingDraftInput,
): Promise<{ draft: AiStorefrontDraft; source: 'ai' | 'fallback' }> {
  if (process.env.NVIDIA_API_KEY || process.env.NVIDIA_KEY) {
    try {
      return { draft: await draftStorefrontCopy(input), source: 'ai' };
    } catch {
      // Fall through to the template draft; the caller reports the source.
    }
  }
  return { draft: fallbackStorefrontDraft(input), source: 'fallback' };
}

export function validateDraftInput(raw: unknown): OnboardingDraftInput {
  if (!isRecord(raw)) throw new OnboardingError('request body must be an object');
  return {
    businessName: requiredString(raw.businessName, 'businessName', 200),
    town: requiredString(raw.town, 'town', 100),
    trade: requiredString(raw.trade, 'trade', 80),
    notes: optionalString(raw.notes, 'notes', 2000),
  };
}

export function validateSubmitInput(raw: unknown): OnboardingSubmitInput {
  if (!isRecord(raw)) throw new OnboardingError('request body must be an object');

  const phone = optionalString(raw.phone, 'phone', 40);
  const email = optionalString(raw.email, 'email', 320);
  if (!phone && !email) {
    throw new OnboardingError('a phone number or email is required so customers can reach you');
  }

  const taxRateMillipercent = raw.taxRateMillipercent ?? 0;
  if (
    typeof taxRateMillipercent !== 'number'
    || !Number.isInteger(taxRateMillipercent)
    || taxRateMillipercent < 0
    || taxRateMillipercent > 100000
  ) {
    throw new OnboardingError('taxRateMillipercent must be an integer millipercent 0..100000');
  }

  const templateId = raw.templateId ?? 'heritage-craft';
  if (!isPublicSiteTemplateId(templateId)) {
    throw new OnboardingError('templateId is not a template in the catalog');
  }

  return {
    businessName: requiredString(raw.businessName, 'businessName', 200),
    town: requiredString(raw.town, 'town', 100),
    trade: requiredString(raw.trade, 'trade', 80),
    notes: optionalString(raw.notes, 'notes', 2000),
    phone,
    email,
    address: optionalString(raw.address, 'address', 200),
    hours: optionalString(raw.hours, 'hours', 100),
    taxRateMillipercent,
    templateId: templateId as string,
    draft: raw.draft,
  };
}

/**
 * Builds the provisioning contract the control plane accepts. The confirmed
 * copy is re-validated and merged into a config document; the document must
 * pass approval readiness before we ever call the control plane.
 */
export function buildProvisionContract(input: OnboardingSubmitInput): ProvisionContract {
  let draft: AiStorefrontDraft;
  try {
    draft = validateAiDraft(input.draft);
  } catch {
    draft = fallbackStorefrontDraft(input);
  }

  const businessName = input.businessName;
  const base = createEmptyConfigDraft({
    identity: { businessName, tagline: '' },
    contact: {
      phone: input.phone ?? '',
      email: input.email ?? '',
      address: input.address ?? '',
      hours: input.hours ?? '',
    },
    tax: { taxRateMillipercent: input.taxRateMillipercent ?? 0 },
    documents: { prefixes: derivePrefixes(businessName) },
  });

  let config = mergeStorefrontDraft(base, draft);
  if (!isApprovalReady(config)) {
    // A structurally valid but empty draft (or a failed AI call) degrades to
    // the deterministic template draft rather than a half-empty storefront.
    draft = fallbackStorefrontDraft(input);
    config = mergeStorefrontDraft(base, draft);
  }
  if (!isApprovalReady(config)) {
    throw new OnboardingError(
      'storefront copy is not ready yet — add a business name and at least one service',
    );
  }

  const slug = slugify(businessName);
  if (!SLUG_PATTERN.test(slug) || slug.length > 63) {
    throw new OnboardingError('business name does not produce a valid subdomain');
  }

  const { version: _version, templateId, catalogVersion: _catalogVersion, ...configBody } = config;
  return {
    slug,
    displayName: businessName,
    canonicalHostname: `${slug}.usejbox.com`,
    templateId: templateId as PublicSiteTemplateId,
    config: configBody,
  };
}

/**
 * Calls the control plane to provision the tenant. The control plane validates
 * the contract again, writes the organization atomically, and returns it in
 * 'provisioning' state — DNS verification and activation happen after.
 */
export async function provisionTenantViaControlPlane(
  contract: ProvisionContract,
): Promise<{ organizationId: string; slug: string; canonicalHostname: string }> {
  const baseUrl = process.env.CONTROL_BASE_URL ?? 'https://jbox-control.vercel.app';
  const token = process.env.CONTROL_API_TOKEN;
  if (!token) {
    throw new OnboardingError('signups are not configured yet (CONTROL_API_TOKEN is missing)', 503);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/organizations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(contract),
      cache: 'no-store',
    });
  } catch {
    throw new OnboardingError('the signup service is unreachable right now — please try again', 503);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : `signup service responded ${response.status}`;
    const status = response.status === 409 ? 409 : 502;
    throw new OnboardingError(message, status);
  }

  const tenant = isRecord(body) ? body.tenant : null;
  if (!isRecord(tenant) || typeof tenant.organizationId !== 'string') {
    throw new OnboardingError('signup service returned an unexpected response', 502);
  }
  return {
    organizationId: tenant.organizationId,
    slug: typeof tenant.slug === 'string' ? tenant.slug : contract.slug,
    canonicalHostname: typeof tenant.canonicalHostname === 'string'
      ? tenant.canonicalHostname
      : contract.canonicalHostname,
  };
}
