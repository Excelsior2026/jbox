/**
 * AI drafting for the onboarding wizard.
 *
 * The division of labor is fixed by product decision: the model drafts COPY
 * (tagline, hero, about, service area, service descriptions). A human chooses
 * the template and colors, and a human approves the result. The model never
 * sets branding, pricing, or anything the tenant is legally accountable for.
 *
 * This package is the only place in the platform that talks to the model. It
 * talks to NVIDIA's hosted model API (an OpenAI-compatible endpoint), driven by
 * the NVIDIA API key configured in the deployed environment. Server-side only —
 * the key never reaches a browser.
 */
import {
  CONFIG_DOCUMENT_VERSION,
  PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
  validateConfigDocument,
  type ConfigV1,
} from '@contractor-platform/configuration';

const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
const AI_MODEL = process.env.AI_MODEL ?? 'meta/llama-3.1-405b-instruct';
const AI_TIMEOUT_MS = 60_000;

/** A failure of the model call or of parsing its output. Retryable. */
export class AiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiError';
  }
}

export type StorefrontDraftInput = {
  businessName: string;
  town: string;
  trade: string;
  notes?: string;
};

export type AiServiceDraft = {
  slug: string;
  name: string;
  description: string;
};

export type AiStorefrontDraft = {
  tagline: string;
  hero: { headline: string; subheadline: string };
  about: { body: string };
  serviceArea: { description: string };
  services: AiServiceDraft[];
};

/**
 * Pulls a JSON object out of a model response, tolerating markdown fences and
 * surrounding prose. Throws AiError when there is nothing parseable.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new AiError('Model output contained no JSON object.');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new AiError('Model output was not valid JSON.', error);
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function uniqueSlug(name: string, used: Set<string>): string {
  let slug = slugify(name) || 'service';
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let n = 2;
  while (used.has(`${slug}-${n}`)) n += 1;
  slug = `${slug}-${n}`;
  used.add(slug);
  return slug;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string, maxLength: number): string {
  const value = record[key];
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength);
}

/**
 * Validates the model's draft shape. The model may invent content; it must not
 * be able to break the document shape. Every field is coerced to a bounded
 * string, so a hostile or malformed response degrades to empty copy rather than
 * an exception the wizard cannot recover from.
 */
export function validateAiDraft(value: unknown): AiStorefrontDraft {
  if (!isRecord(value)) throw new AiError('Model output was not an object.');

  const tagline = readString(value, 'tagline', 200);
  const hero = isRecord(value.hero) ? value.hero : {};
  const about = isRecord(value.about) ? value.about : {};
  const serviceArea = isRecord(value.serviceArea) ? value.serviceArea : {};

  const services: AiServiceDraft[] = [];
  const usedSlugs = new Set<string>();
  if (Array.isArray(value.services)) {
    for (const entry of value.services.slice(0, 12)) {
      if (!isRecord(entry)) continue;
      const name = readString(entry, 'name', 80);
      if (!name.trim()) continue;
      services.push({
        slug: uniqueSlug(name, usedSlugs),
        name,
        description: readString(entry, 'description', 300),
      });
    }
  }

  return {
    tagline,
    hero: {
      headline: readString(hero, 'headline', 200),
      subheadline: readString(hero, 'subheadline', 400),
    },
    about: { body: readString(about, 'body', 4000) },
    serviceArea: { description: readString(serviceArea, 'description', 300) },
    services,
  };
}

function buildPrompt(input: StorefrontDraftInput): string {
  return [
    'You write website copy for local service businesses. Return ONLY a JSON object with this exact shape:',
    '{',
    '  "tagline": "one short sentence",',
    '  "hero": { "headline": "under 10 words", "subheadline": "one or two sentences" },',
    '  "about": { "body": "2-4 sentences about the business" },',
    '  "serviceArea": { "description": "one sentence naming the town served" },',
    '  "services": [ { "name": "service name", "description": "one or two sentences" } ]',
    '}',
    '',
    'Rules:',
    '- 3 to 5 services.',
    '- Plain, trustworthy, local tone. No hype, no exclamation points.',
    '- Do not invent phone numbers, emails, addresses, prices, or credentials.',
    '- Do not invent a business history. If none is given, speak generally.',
    '- Write in clear English.',
    '',
    `Business name: ${input.businessName}`,
    `Town served: ${input.town}`,
    `Trade: ${input.trade}`,
    input.notes ? `Additional context: ${input.notes}` : '',
  ].filter((line) => line.length > 0).join('\n');
}

/**
 * Drafts storefront copy for the onboarding wizard. Requires NVIDIA_API_KEY in
 * the environment. Never sets template, colors, pricing, or tax — those are the
 * human's.
 */
export async function draftStorefrontCopy(
  input: StorefrontDraftInput,
): Promise<AiStorefrontDraft> {
  const apiKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_KEY;
  if (!apiKey) {
    throw new AiError('NVIDIA_API_KEY is not set. The model cannot be called.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: buildPrompt(input) }],
        temperature: 0.7,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new AiError(
      `Failed to reach the model API (${AI_MODEL}). Check NVIDIA_API_KEY and network access.`,
      error,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AiError(`Model API responded ${response.status} ${response.statusText}.`);
  }

  const body: unknown = await response.json().catch((error) => {
    throw new AiError('Model API returned a non-JSON response.', error);
  });
  let content = '';
  if (isRecord(body) && Array.isArray(body.choices)) {
    const first = body.choices[0];
    if (isRecord(first) && isRecord(first.message)) {
      content = readString(first.message, 'content', 100_000);
    }
  }
  if (!content) {
    throw new AiError('Model API returned no message content.');
  }

  return validateAiDraft(extractJsonObject(content));
}

/**
 * Merges a model draft into a tenant config document. The base document is the
 * human's choices (template, colors, tax, prefixes) plus whatever the wizard
 * collected directly (business name, contact). The draft fills only copy. The
 * result is structurally validated before returning, so a bad merge cannot
 * reach the database.
 */
export function mergeStorefrontDraft(
  base: ConfigV1,
  draft: AiStorefrontDraft,
): ConfigV1 {
  const merged: ConfigV1 = {
    version: CONFIG_DOCUMENT_VERSION,
    templateId: base.templateId,
    catalogVersion: PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
    brand: { ...base.brand },
    identity: { ...base.identity, tagline: draft.tagline || base.identity.tagline },
    contact: { ...base.contact },
    serviceArea: { ...base.serviceArea, description: draft.serviceArea.description },
    services: draft.services.map((service) => ({
      slug: service.slug,
      name: service.name,
      description: service.description,
      priceFromCents: null,
    })),
    hero: { ...base.hero, ...draft.hero },
    about: { ...base.about, body: draft.about.body },
    documents: {
      prefixes: { ...base.documents.prefixes },
    },
    tax: { ...base.tax },
  };
  return validateConfigDocument(merged);
}
