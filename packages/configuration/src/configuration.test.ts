import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_SITE_TEMPLATE_ID,
  PUBLIC_SITE_TEMPLATE_CATALOG_VERSION,
  PUBLIC_SITE_TEMPLATES,
  assertApprovalReady,
  createEmptyConfigDraft,
  isPublicSitePresentation,
  isPublicSiteTemplateId,
  publicSiteThemeClass,
  validateConfigDocument,
  type ConfigV1,
} from './index';

const sixTemplateIds = new Set(PUBLIC_SITE_TEMPLATES.map((template) => template.id));

describe('template catalog', () => {
  it('defines exactly the six templates with unique ids', () => {
    expect(sixTemplateIds.size).toBe(6);
  });

  it('guards template ids against catalog drift', () => {
    expect(isPublicSiteTemplateId('modern-grid')).toBe(true);
    expect(isPublicSiteTemplateId('modern-grid-v2')).toBe(false);
    expect(isPublicSiteTemplateId(undefined)).toBe(false);
  });

  it('derives a theme class from the template id, so they cannot drift', () => {
    for (const id of sixTemplateIds) {
      expect(publicSiteThemeClass(id as never)).toBe(`tpl-${id}`);
    }
  });

  it('validates a presentation against the current catalog version', () => {
    expect(isPublicSitePresentation({ templateId: 'heritage-craft', catalogVersion: 1 })).toBe(true);
    expect(isPublicSitePresentation({ templateId: 'heritage-craft', catalogVersion: 2 })).toBe(false);
    expect(isPublicSitePresentation({ templateId: 'nope', catalogVersion: 1 })).toBe(false);
    expect(isPublicSitePresentation(null)).toBe(false);
  });
});

describe('config document', () => {
  it('drafts the empty skeleton valid and defaulted', () => {
    const draft = createEmptyConfigDraft();
    expect(validateConfigDocument(draft)).toBe(draft);
    expect(draft.templateId).toBe(DEFAULT_PUBLIC_SITE_TEMPLATE_ID);
    expect(draft.catalogVersion).toBe(PUBLIC_SITE_TEMPLATE_CATALOG_VERSION);
    expect(draft.version).toBe('config-v1');
  });

  it('accepts a fully populated document', () => {
    const doc = createEmptyConfigDraft({
      identity: { businessName: 'Paris Electric', tagline: 'Hire the best' },
      contact: { phone: '555-0100', email: 'hi@paris.example', address: '1 Main St', hours: 'Mon-Fri 8-5' },
      services: [{ slug: 'panel-upgrade', name: 'Panel Upgrade', description: '200A upgrades', priceFromCents: 450000 }],
      hero: { headline: 'Electric done right', subheadline: 'Locally owned since 1979' },
      about: { body: 'We are electricians.' },
      tax: { taxRateMillipercent: 8000 },
    });
    const validated = validateConfigDocument(doc);
    expect(validated.services[0].priceFromCents).toBe(450000);
    expect(validated.tax.taxRateMillipercent).toBe(8000);
  });

  it('rejects an unknown template id even in an otherwise valid doc', () => {
    const doc = createEmptyConfigDraft();
    const bad = { ...doc, templateId: 'heritage-craft-v9' };
    expect(() => validateConfigDocument(bad)).toThrow(/templateId/);
  });

  it('rejects a malformed color', () => {
    const doc = createEmptyConfigDraft();
    const bad = { ...doc, brand: { ...doc.brand, accentColor: 'blue' } };
    expect(() => validateConfigDocument(bad)).toThrow(/brand\.accentColor/);
  });

  it('rejects an unknown field', () => {
    const doc = createEmptyConfigDraft();
    expect(() => validateConfigDocument({ ...doc, claims: [] })).toThrow(/claims: unknown field/);
  });

  it('reports every problem, not just the first', () => {
    expect(() => validateConfigDocument({})).toThrow(/version|catalogVersion|templateId/);
    const error = () => validateConfigDocument({ version: 'config-v1' });
    expect(error).toThrow(/; /);
  });

  it('rejects a bad service price and slug', () => {
    const doc = createEmptyConfigDraft();
    doc.services = [{ slug: 'Bad Slug', name: 'X', description: '', priceFromCents: -5 }];
    expect(() => validateConfigDocument(doc)).toThrow(/services\[0\]/);
  });
});

describe('approval readiness', () => {
  it('refuses an empty draft', () => {
    expect(() => assertApprovalReady(createEmptyConfigDraft())).toThrow(/at least one service/);
  });

  it('refuses a draft without any reachable contact', () => {
    const doc = createEmptyConfigDraft({
      hero: { headline: 'Electric done right', subheadline: '' },
      services: [{ slug: 'panel-upgrade', name: 'Panel Upgrade', description: '200A upgrades', priceFromCents: null }],
    });
    expect(() => assertApprovalReady(doc)).toThrow(/phone or email/);
  });

  it('approves a populated, reachable document', () => {
    const doc: ConfigV1 = createEmptyConfigDraft({
      identity: { businessName: 'Paris Electric', tagline: '' },
      contact: { phone: '555-0100', email: '', address: '', hours: '' },
      hero: { headline: 'Electric done right', subheadline: '' },
      services: [{ slug: 'panel-upgrade', name: 'Panel Upgrade', description: '200A upgrades', priceFromCents: null }],
    });
    expect(() => assertApprovalReady(doc)).not.toThrow();
  });
});
