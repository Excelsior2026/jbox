/**
 * Versioned, approval-gated tenant configuration and the public-site template
 * catalog.
 *
 * The document (`config-v1`) holds branding and business facts only — no
 * claims, no regulatory language. The catalog is versioned and typed so a
 * stored template selection cannot silently drift out of range.
 */
export {
  CONFIG_DOCUMENT_VERSION,
  DEFAULT_BRAND_PALETTE,
  DEFAULT_DOCUMENT_PREFIXES,
  assertApprovalReady,
  createEmptyConfigDraft,
  validateConfigDocument,
} from './config';
export type {
  BrandPalette,
  ConfigV1,
  ContactInfo,
  DocumentPrefixes,
  HexColor,
  ServiceDefinition,
} from './config';
export {
  DEFAULT_PUBLIC_SITE_TEMPLATE_ID,
  PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
  PUBLIC_SITE_TEMPLATES,
  isPublicSitePresentation,
  isPublicSiteTemplateId,
  publicSiteTemplateById,
  publicSiteThemeClass,
} from './templates';
export type {
  PublicSiteTemplate,
  PublicSiteTemplateId,
} from './templates';
