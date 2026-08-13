import { describe, expect, it } from 'vitest';
import {
  OnboardingError,
  buildProvisionContract,
  derivePrefixes,
  draftStorefrontFor,
  fallbackStorefrontDraft,
  slugify,
  validateDraftInput,
  validateSubmitInput,
} from './onboarding';

const VALID_DRAFT = {
  tagline: 'Family electricians you can trust.',
  hero: { headline: 'The right fix, done right.', subheadline: 'Local electricians serving Patchogue.' },
  about: { body: 'We are a family electrician serving Patchogue and nearby towns.' },
  serviceArea: { description: 'Serving Patchogue and nearby towns.' },
  services: [
    { name: 'Repairs', description: 'Fast, honest repairs.' },
    { name: 'EV chargers', description: 'Chargers installed and wired to code.' },
    { name: 'Panels', description: 'Panel upgrades and service work.' },
  ],
};

describe('slugify', () => {
  it('turns a business name into a URL-safe slug', () => {
    expect(slugify('Paris Electric')).toBe('paris-electric');
    expect(slugify('A & B Electric, Inc.')).toBe('a-b-electric-inc');
    expect(slugify('123 Plumbing')).toBe('123-plumbing');
    expect(slugify('  Électricité  Rive  Sud  ')).toBe('electricite-rive-sud');
  });

  it('never returns an empty slug', () => {
    expect(slugify('   ')).toBe('tenant');
    expect(slugify('!!!')).toBe('tenant');
  });
});

describe('derivePrefixes', () => {
  it('uses business-name initials, capped at three letters', () => {
    const prefixes = derivePrefixes('Paris Electric');
    expect(prefixes).toEqual({
      customer: 'PEC',
      estimate: 'PEE',
      serviceRequest: 'PES',
      job: 'PEJ',
      invoice: 'PEI',
      receipt: 'PER',
    });
    expect(derivePrefixes('Alpha Beta Gamma Delta')).toMatchObject({
      estimate: 'ABGE',
      customer: 'ABGC',
    });
  });

  it('falls back to the platform default when initials are not a valid prefix', () => {
    expect(derivePrefixes('123 by 12 LLC')).toMatchObject({
      estimate: 'JBE',
      receipt: 'JBR',
    });
    expect(derivePrefixes('! ?')).toMatchObject({
      estimate: 'JBE',
    });
  });
});

describe('fallbackStorefrontDraft', () => {
  it('produces a complete, structurally valid draft', () => {
    const draft = fallbackStorefrontDraft({
      businessName: 'Paris Electric',
      trade: 'electrician',
      town: 'Patchogue, NY',
    });
    expect(draft.tagline).toBeTruthy();
    expect(draft.hero.headline).toBeTruthy();
    expect(draft.hero.subheadline).toContain('Paris Electric');
    expect(draft.about.body).toContain('Patchogue');
    expect(draft.services).toHaveLength(3);
    const slugs = draft.services.map((service) => service.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('appends notes to the about copy when provided', () => {
    const draft = fallbackStorefrontDraft({
      businessName: 'Paris Electric',
      trade: 'electrician',
      town: 'Patchogue',
      notes: 'Serving Suffolk County since 1998.',
    });
    expect(draft.about.body).toContain('since 1998');
  });
});

describe('validateDraftInput', () => {
  it('accepts a valid payload', () => {
    const input = validateDraftInput({
      businessName: 'Paris Electric',
      town: 'Patchogue',
      trade: 'electrician',
    });
    expect(input.businessName).toBe('Paris Electric');
  });

  it('rejects missing or oversized fields', () => {
    expect(() => validateDraftInput({ town: 'Patchogue', trade: 'electrician' }))
      .toThrow(OnboardingError);
    expect(() =>
      validateDraftInput({ businessName: 'x'.repeat(201), town: 'Patchogue', trade: 'electrician' }),
    ).toThrow(OnboardingError);
  });
});

describe('validateSubmitInput', () => {
  it('requires a phone or email contact', () => {
    expect(() =>
      validateSubmitInput({
        businessName: 'Paris Electric',
        town: 'Patchogue',
        trade: 'electrician',
        phone: '',
        email: '',
        draft: VALID_DRAFT,
      }),
    ).toThrow(/phone number or email/);
  });

  it('rejects an out-of-range tax rate', () => {
    expect(() =>
      validateSubmitInput({
        businessName: 'Paris Electric',
        town: 'Patchogue',
        trade: 'electrician',
        phone: '555-0100',
        taxRateMillipercent: 100001,
        draft: VALID_DRAFT,
      }),
    ).toThrow(/taxRateMillipercent/);
  });

  it('rejects an unknown template id', () => {
    expect(() =>
      validateSubmitInput({
        businessName: 'Paris Electric',
        town: 'Patchogue',
        trade: 'electrician',
        phone: '555-0100',
        templateId: 'not-a-template',
        draft: VALID_DRAFT,
      }),
    ).toThrow(/templateId/);
  });
});

describe('buildProvisionContract', () => {
  it('builds a valid contract for the control plane', () => {
    const contract = buildProvisionContract({
      businessName: 'Paris Electric',
      town: 'Patchogue',
      trade: 'electrician',
      phone: '555-0100',
      email: 'hello@paris.test',
      hours: 'Mon-Fri 8a-5p',
      draft: VALID_DRAFT,
    });

    expect(contract.slug).toBe('paris-electric');
    expect(contract.displayName).toBe('Paris Electric');
    expect(contract.canonicalHostname).toBe('paris-electric.usejbox.com');
    expect(contract.templateId).toBe('heritage-craft');

    expect(contract.config.version).toBeUndefined();
    expect(contract.config.templateId).toBeUndefined();
    expect(contract.config.identity.businessName).toBe('Paris Electric');
    expect(contract.config.identity.tagline).toBe(VALID_DRAFT.tagline);
    expect(contract.config.services).toHaveLength(3);
    expect(contract.config.services[0]).toMatchObject({
      name: 'Repairs',
      priceFromCents: null,
    });
    expect(contract.config.hero.headline).toBe(VALID_DRAFT.hero.headline);
    expect(contract.config.contact.phone).toBe('555-0100');
    expect(contract.config.documents.prefixes.estimate).toBe('PEE');
  });

  it('degrades a malformed draft to the template draft instead of failing', () => {
    const contract = buildProvisionContract({
      businessName: 'Paris Electric',
      town: 'Patchogue',
      trade: 'electrician',
      phone: '555-0100',
      draft: { not: 'a draft' },
    });
    expect(contract.config.hero.headline).toBeTruthy();
    expect(contract.config.services.length).toBeGreaterThan(0);
  });
});

describe('draftStorefrontFor', () => {
  it('uses the template draft when no AI key is configured', async () => {
    const previous = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = undefined;
    try {
      const { draft, source } = await draftStorefrontFor({
        businessName: 'Paris Electric',
        town: 'Patchogue',
        trade: 'electrician',
      });
      expect(source).toBe('fallback');
      expect(draft.services.length).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = previous;
    }
  });
});
