import { describe, expect, it } from 'vitest';
import {
  buildConfigDocument,
  ContractError,
  validateProvisionTenantInput,
  type ProvisionTenantInput,
} from '@/lib/control-contract';

function validInput(overrides: Partial<ProvisionTenantInput> = {}): ProvisionTenantInput {
  return {
    slug: 'paris-electric',
    displayName: 'Paris Electric',
    canonicalHostname: 'paris.usejbox.com',
    config: {
      brand: { primaryColor: '#f3a712', accentColor: '#213547', surfaceColor: '#fffaf0' },
      identity: { businessName: 'Paris Electric', tagline: 'Licensed electricians' },
      contact: { phone: '(631) 946-9998', email: '', address: 'Suffolk County', hours: 'Mon-Fri 8a-5p' },
      serviceArea: { description: 'Suffolk County, Long Island, New York' },
      services: [{ slug: 'residential', name: 'Residential', description: 'Repairs and upgrades', priceFromCents: null }],
      hero: { headline: 'Electricians Long Island trusts', subheadline: 'Family-run since 1998.' },
      about: { body: 'A licensed electrical contractor.' },
      documents: { prefixes: { customer: 'PE', estimate: 'PE', serviceRequest: 'PE', job: 'PE', invoice: 'PE', receipt: 'PE' } },
      tax: { taxRateMillipercent: 8625 },
    },
    priceBook: {
      name: 'Paris Electric v1',
      categories: [{
        name: 'Circuits & panels',
        items: [
          { code: 'PE-CIR-001', description: 'Dedicated circuit', unit: 'ea', taxable: true, unitPriceCents: 47500 },
        ],
      }],
    },
    ...overrides,
  };
}

describe('validateProvisionTenantInput', () => {
  it('accepts a well-formed input', () => {
    const parsed = validateProvisionTenantInput(validInput());
    expect(parsed.slug).toBe('paris-electric');
    expect(parsed.canonicalHostname).toBe('paris.usejbox.com');
    expect(parsed.priceBook?.categories).toHaveLength(1);
  });

  it('normalizes the canonical hostname to lowercase', () => {
    const parsed = validateProvisionTenantInput(validInput({ canonicalHostname: 'Paris.UseJbox.COM' }));
    expect(parsed.canonicalHostname).toBe('paris.usejbox.com');
  });

  it('rejects an invalid slug', () => {
    expect(() => validateProvisionTenantInput(validInput({ slug: 'Paris_Electric!' })))
      .toThrow(ContractError);
  });

  it('rejects a missing display name', () => {
    expect(() => validateProvisionTenantInput(validInput({ displayName: '' })))
      .toThrow(/displayName/);
  });

  it('rejects a price book item with a non-integer price', () => {
    const input = validInput();
    input.priceBook!.categories[0].items[0].unitPriceCents = 475.5;
    expect(() => validateProvisionTenantInput(input)).toThrow(/unitPriceCents/);
  });

  it('rejects an unknown template id', () => {
    const input = validInput();
    (input as { templateId?: unknown }).templateId = 'not-a-template';
    expect(() => validateProvisionTenantInput(input)).toThrow(/templateId/);
  });
});

describe('buildConfigDocument', () => {
  it('fills version, template and catalog version from the document contract', () => {
    const config = buildConfigDocument(validInput());
    expect(config.version).toBe('config-v1');
    expect(config.catalogVersion).toBe(1);
    expect(config.templateId).toBe('heritage-craft');
    expect(config.tax.taxRateMillipercent).toBe(8625);
  });

  it('rejects a config that is not approval-ready', () => {
    const input = validInput();
    input.config.services = [];
    expect(() => buildConfigDocument(input)).toThrow(/not ready to approve/);
  });
});
