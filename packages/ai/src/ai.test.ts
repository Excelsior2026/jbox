import { describe, expect, it } from 'vitest';
import { createEmptyConfigDraft, validateConfigDocument } from '@contractor-platform/configuration';
import {
  AiError,
  extractJsonObject,
  mergeStorefrontDraft,
  validateAiDraft,
  type AiStorefrontDraft,
} from './index';

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a markdown fence', () => {
    const output = 'Here you go:\n```json\n{"tagline":"Trusted","services":[]}\n```';
    expect(extractJsonObject(output)).toEqual({ tagline: 'Trusted', services: [] });
  });

  it('extracts the object from surrounding prose', () => {
    const output = 'Sure! The copy is: {"hero":{"headline":"Electric done right"}} Done.';
    expect(extractJsonObject(output)).toEqual({ hero: { headline: 'Electric done right' } });
  });

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no json here')).toThrow(AiError);
  });

  it('throws when the JSON is malformed', () => {
    expect(() => extractJsonObject('{"broken": }')).toThrow(AiError);
  });
});

describe('validateAiDraft', () => {
  it('coerces a well-formed draft', () => {
    const draft = validateAiDraft({
      tagline: 'Trusted for decades',
      hero: { headline: 'Electric done right', subheadline: 'Locally owned.' },
      about: { body: 'We are electricians.' },
      serviceArea: { description: 'Serving Springfield.' },
      services: [
        { name: 'Panel Upgrade', description: '200A upgrades.' },
        { name: 'Panel Upgrade', description: 'Duplicate name gets a unique slug.' },
      ],
    });
    expect(draft.services).toHaveLength(2);
    expect(draft.services[0].slug).toBe('panel-upgrade');
    expect(draft.services[1].slug).toBe('panel-upgrade-2');
  });

  it('degrades hostile input to empty copy instead of throwing', () => {
    const draft = validateAiDraft({ services: [{ name: 42 }], hero: 'not an object' });
    expect(draft.services).toEqual([]);
    expect(draft.hero).toEqual({ headline: '', subheadline: '' });
  });

  it('throws for a non-object', () => {
    expect(() => validateAiDraft('nope')).toThrow(AiError);
    expect(() => validateAiDraft(null)).toThrow(AiError);
  });

  it('caps the number of services and truncates long fields', () => {
    const services = Array.from({ length: 20 }, (_, i) => ({
      name: `Service ${i}`,
      description: 'x'.repeat(500),
    }));
    const draft = validateAiDraft({ services });
    expect(draft.services).toHaveLength(12);
    expect(draft.services[0].description).toHaveLength(300);
  });
});

describe('mergeStorefrontDraft', () => {
  it('fills copy into a human-chosen base and validates the result', () => {
    const base = createEmptyConfigDraft({
      identity: { businessName: 'Paris Electric', tagline: '' },
      contact: { phone: '555-0100', email: '', address: '', hours: '' },
    });
    const draft: AiStorefrontDraft = {
      tagline: 'Trusted local electricians',
      hero: { headline: 'Electric done right', subheadline: 'Since forever.' },
      about: { body: 'We are electricians.' },
      serviceArea: { description: 'Serving Springfield.' },
      services: [{ slug: 'panel-upgrade', name: 'Panel Upgrade', description: '200A upgrades.' }],
    };

    const merged = mergeStorefrontDraft(base, draft);
    expect(validateConfigDocument(merged)).toBe(merged);
    expect(merged.identity.businessName).toBe('Paris Electric');
    expect(merged.identity.tagline).toBe('Trusted local electricians');
    expect(merged.services[0].priceFromCents).toBeNull();
    expect(merged.templateId).toBe(base.templateId);
    expect(merged.brand).toEqual(base.brand);
  });

  it('never lets the draft override template, brand, tax, or prefixes', () => {
    const base = createEmptyConfigDraft();
    const merged = mergeStorefrontDraft(base, {
      tagline: '',
      hero: { headline: '', subheadline: '' },
      about: { body: '' },
      serviceArea: { description: '' },
      services: [],
    });
    expect(merged.templateId).toBe(base.templateId);
    expect(merged.brand).toEqual(base.brand);
    expect(merged.tax).toEqual(base.tax);
    expect(merged.documents.prefixes).toEqual(base.documents.prefixes);
  });
});
