/**
 * Public-site template catalog.
 *
 * A tenant's storefront is picked from this catalog at onboarding and stored in
 * the versioned configuration document as `{ templateId, catalogVersion }`.
 * The catalog is versioned so a stored selection cannot silently drift out of
 * range when templates are added or removed: a config carrying catalogVersion 1
 * is validated against catalog version 1 forever.
 *
 * Templates vary presentation, never structure — every template renders the same
 * storefront pages (home, services, contact). The `themeClass` a template maps
 * to is derived from its id, not hand-written, so renaming a stylesheet class in
 * the product app is a compile error rather than a silently broken page.
 */

export const PUBLIC_SITE_TEMPLATE_CATALOG_VERSION = 1;

export type PublicSiteTemplate = {
  id: string;
  name: string;
  positioning: string;
  description: string;
};

export const PUBLIC_SITE_TEMPLATES = [
  {
    id: 'heritage-craft',
    name: 'Heritage Craft',
    positioning: 'Established, detailed, local',
    description:
      'Serif display type and a warm neutral palette. For a family trade that has '
      + 'served its town for decades and wants to say so.',
  },
  {
    id: 'modern-grid',
    name: 'Modern Grid',
    positioning: 'Modern, precise, clear',
    description:
      'Geometric layout, generous whitespace, restrained color. For a firm that '
      + 'wants to look as organised as its work.',
  },
  {
    id: 'neighborly-warm',
    name: 'Neighborly',
    positioning: 'Warm, familiar, helpful',
    description:
      'Rounded shapes and approachable copy. For a small crew that trades on '
      + 'being the friendly local choice.',
  },
  {
    id: 'industrial-pro',
    name: 'Industrial Pro',
    positioning: 'Direct, technical, capable',
    description:
      'Bold condensed type and high contrast. For crews that lead with capability '
      + 'and want the pitch to be short.',
  },
  {
    id: 'premium-home',
    name: 'Premium Home',
    positioning: 'Refined, calm, residential',
    description:
      'Quiet layout and muted tones. For residential work where trust and finish '
      + 'are the whole story.',
  },
  {
    id: 'direct-response',
    name: 'Direct Response',
    positioning: 'Visible, fast, action-led',
    description:
      'High-contrast accents and a persistent request-to-quote button. For '
      + 'lead-generation first and foremost.',
  },
] as const satisfies readonly PublicSiteTemplate[];

export type PublicSiteTemplateId = (typeof PUBLIC_SITE_TEMPLATES)[number]['id'];

export const DEFAULT_PUBLIC_SITE_TEMPLATE_ID: PublicSiteTemplateId = 'heritage-craft';

export function isPublicSiteTemplateId(value: unknown): value is PublicSiteTemplateId {
  return PUBLIC_SITE_TEMPLATES.some((template) => template.id === value);
}

export function publicSiteTemplateById(
  id: PublicSiteTemplateId,
): (typeof PUBLIC_SITE_TEMPLATES)[number] {
  const found = PUBLIC_SITE_TEMPLATES.find((template) => template.id === id);
  if (!found) throw new Error(`Unknown public-site template: ${id}`);
  return found;
}

export function isPublicSitePresentation(value: unknown): value is {
  templateId: PublicSiteTemplateId;
  catalogVersion: typeof PUBLIC_SITE_TEMPLATE_CATALOG_VERSION;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { templateId?: unknown; catalogVersion?: unknown };
  return candidate.catalogVersion === PUBLIC_SITE_TEMPLATE_CATALOG_VERSION
    && isPublicSiteTemplateId(candidate.templateId);
}

/**
 * The CSS theme class a template renders with, derived from the id. Templates
 * and their classes cannot drift apart because the class is computed, not
 * maintained by hand.
 */
export function publicSiteThemeClass(id: PublicSiteTemplateId): string {
  return `tpl-${id}`;
}
