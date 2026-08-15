import { describe, expect, it } from 'vitest';
import {
  applyCustomerDetailUpdate,
  canDisplayAcceptedSignature,
  canPresentCustomerEstimate,
  isPriceBookReleaseId,
  priceBookReleaseSnapshotMatches,
  resolveActiveLinePriceOrigin,
  resolveEditedLinePriceOrigin,
  resolveStoredLinePriceOrigin,
  resolveStoredSignatureContext,
} from './customer-estimate-presentation';

const RELEASE_ONE_ID = '550e8400-e29b-41d4-a716-446655440000';
const RELEASE_TWO_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('price-book release identity', () => {
  it('accepts only canonical UUID release identifiers', () => {
    expect(isPriceBookReleaseId(RELEASE_ONE_ID)).toBe(true);
    expect(isPriceBookReleaseId(' release-1 ')).toBe(false);
    expect(isPriceBookReleaseId('not-a-uuid')).toBe(false);
    expect(isPriceBookReleaseId(null)).toBe(false);
  });

  it('requires the release id and status to remain unchanged across a read', () => {
    const expected = {
      releaseId: RELEASE_ONE_ID,
      status: 'published',
    } as const;

    expect(priceBookReleaseSnapshotMatches(expected, expected)).toBe(true);
    expect(priceBookReleaseSnapshotMatches(expected, {
      ...expected,
      releaseId: RELEASE_TWO_ID,
    })).toBe(false);
    expect(priceBookReleaseSnapshotMatches(expected, {
      ...expected,
      status: 'draft',
    })).toBe(false);
  });
});

describe('canPresentCustomerEstimate', () => {
  it('allows protected customer presentation only from a published database price book', () => {
    expect(canPresentCustomerEstimate({
      protectedAccess: true,
      priceBookSource: 'database',
      priceBookReleaseStatus: 'published',
      linePriceOrigins: ['published-price-book', 'technician-custom'],
    })).toBe(true);
  });

  it('blocks protected presentation when any estimate line has unverified pricing', () => {
    expect(canPresentCustomerEstimate({
      protectedAccess: true,
      priceBookSource: 'database',
      priceBookReleaseStatus: 'published',
      linePriceOrigins: ['published-price-book', 'unverified', 'technician-custom'],
    })).toBe(false);
  });

  it.each([
    { priceBookSource: 'connecting', priceBookReleaseStatus: 'draft' },
    { priceBookSource: 'connecting', priceBookReleaseStatus: 'published' },
    { priceBookSource: 'offline', priceBookReleaseStatus: 'draft' },
    { priceBookSource: 'offline', priceBookReleaseStatus: 'published' },
    { priceBookSource: 'database', priceBookReleaseStatus: 'draft' },
  ] as const)(
    'blocks protected customer presentation for $priceBookSource + $priceBookReleaseStatus pricing',
    ({ priceBookSource, priceBookReleaseStatus }) => {
      expect(canPresentCustomerEstimate({
        protectedAccess: true,
        priceBookSource,
        priceBookReleaseStatus,
        linePriceOrigins: ['published-price-book'],
      })).toBe(false);
    },
  );

  it.each([
    { priceBookSource: 'connecting', priceBookReleaseStatus: 'draft' },
    { priceBookSource: 'connecting', priceBookReleaseStatus: 'published' },
    { priceBookSource: 'offline', priceBookReleaseStatus: 'draft' },
    { priceBookSource: 'offline', priceBookReleaseStatus: 'published' },
    { priceBookSource: 'database', priceBookReleaseStatus: 'draft' },
    { priceBookSource: 'database', priceBookReleaseStatus: 'published' },
  ] as const)(
    'keeps unprotected local/demo presentation available for $priceBookSource + $priceBookReleaseStatus pricing',
    ({ priceBookSource, priceBookReleaseStatus }) => {
      expect(canPresentCustomerEstimate({
        protectedAccess: false,
        priceBookSource,
        priceBookReleaseStatus,
        linePriceOrigins: ['unverified'],
      })).toBe(true);
    },
  );
});

describe('resolveStoredLinePriceOrigin', () => {
  it('fails stored published price-book origins closed even when database identity is present', () => {
    expect(resolveStoredLinePriceOrigin({
      priceOrigin: 'published-price-book',
      catalogItemId: 'item-1',
      versionId: 'version-1',
      releaseId: 'release-1',
    })).toBe('unverified');

    expect(resolveStoredLinePriceOrigin({
      priceOrigin: 'published-price-book',
      catalogItemId: 'item-1',
    })).toBe('unverified');
  });

  it('preserves technician-custom provenance only for an explicitly custom line', () => {
    expect(resolveStoredLinePriceOrigin({
      priceOrigin: 'technician-custom',
      custom: true,
    })).toBe('technician-custom');

    expect(resolveStoredLinePriceOrigin({
      priceOrigin: 'technician-custom',
    })).toBe('unverified');
  });

  it('fails legacy and malformed stored origins closed', () => {
    expect(resolveStoredLinePriceOrigin({ custom: true })).toBe('unverified');
    expect(resolveStoredLinePriceOrigin({ priceOrigin: 'database-ish' })).toBe('unverified');
    expect(resolveStoredLinePriceOrigin({ priceOrigin: 'unverified' })).toBe('unverified');
  });
});

describe('resolveActiveLinePriceOrigin', () => {
  it('trusts a live published line only for the active release', () => {
    expect(resolveActiveLinePriceOrigin({
      priceOrigin: 'published-price-book',
      lineReleaseId: RELEASE_ONE_ID,
      activeReleaseId: RELEASE_ONE_ID,
    })).toBe('published-price-book');
  });

  it.each([
    { lineReleaseId: RELEASE_ONE_ID, activeReleaseId: RELEASE_TWO_ID },
    { lineReleaseId: undefined, activeReleaseId: RELEASE_ONE_ID },
    { lineReleaseId: RELEASE_ONE_ID, activeReleaseId: null },
    { lineReleaseId: 'release-1', activeReleaseId: 'release-1' },
  ])('fails missing or mismatched release identity closed', ({ lineReleaseId, activeReleaseId }) => {
    expect(resolveActiveLinePriceOrigin({
      priceOrigin: 'published-price-book',
      lineReleaseId,
      activeReleaseId,
    })).toBe('unverified');
  });

  it('preserves explicit custom provenance without a price-book release', () => {
    expect(resolveActiveLinePriceOrigin({
      priceOrigin: 'technician-custom',
      lineReleaseId: undefined,
      activeReleaseId: RELEASE_ONE_ID,
    })).toBe('technician-custom');
  });
});

describe('resolveEditedLinePriceOrigin', () => {
  it.each([
    { update: { unitPrice: 125 }, label: 'unit price' },
    { update: { taxable: false }, label: 'taxable status' },
  ])('invalidates published provenance when $label changes', ({ update }) => {
    expect(resolveEditedLinePriceOrigin({
      priceOrigin: 'published-price-book',
      unitPrice: 100,
      taxable: true,
      update,
    })).toBe('unverified');
  });

  it('preserves provenance for same-value pricing updates and unrelated edits', () => {
    for (const update of [{ unitPrice: 100 }, { taxable: true }, { quantity: 2 }]) {
      expect(resolveEditedLinePriceOrigin({
        priceOrigin: 'published-price-book',
        unitPrice: 100,
        taxable: true,
        update,
      })).toBe('published-price-book');
    }
  });

  it('preserves explicit technician-custom provenance when its price or tax status changes', () => {
    expect(resolveEditedLinePriceOrigin({
      priceOrigin: 'technician-custom',
      unitPrice: 100,
      taxable: true,
      update: { unitPrice: 125, taxable: false },
    })).toBe('technician-custom');
  });
});

describe('canDisplayAcceptedSignature', () => {
  it('trusts only a protected-published signature in protected access', () => {
    expect(canDisplayAcceptedSignature({
      protectedAccess: true,
      signedAt: 'Jul 23, 2026, 8:00 PM',
      signatureContext: 'protected-published',
    })).toBe(true);

    for (const signatureContext of ['demo', 'legacy', undefined, 'malformed']) {
      expect(canDisplayAcceptedSignature({
        protectedAccess: true,
        signedAt: 'Jul 23, 2026, 8:00 PM',
        signatureContext,
      })).toBe(false);
    }
  });

  it('allows demo and legacy signature previews in unprotected access', () => {
    for (const signatureContext of ['protected-published', 'demo', 'legacy', undefined]) {
      expect(canDisplayAcceptedSignature({
        protectedAccess: false,
        signedAt: 'Jul 23, 2026, 8:00 PM',
        signatureContext,
      })).toBe(true);
    }
  });

  it('never displays a signature without an accepted timestamp', () => {
    expect(canDisplayAcceptedSignature({
      protectedAccess: false,
      signedAt: null,
      signatureContext: 'demo',
    })).toBe(false);
  });
});

describe('resolveStoredSignatureContext', () => {
  it('preserves valid capture contexts and marks missing or malformed metadata legacy', () => {
    expect(resolveStoredSignatureContext('protected-published')).toBe('protected-published');
    expect(resolveStoredSignatureContext('demo')).toBe('demo');
    expect(resolveStoredSignatureContext('legacy')).toBe('legacy');
    expect(resolveStoredSignatureContext(undefined)).toBe('legacy');
    expect(resolveStoredSignatureContext('malformed')).toBe('legacy');
  });
});

describe('applyCustomerDetailUpdate', () => {
  it('updates the selected customer field and invalidates the accepted signature', () => {
    const customer = {
      name: 'Jane Smith',
      phone: '(631) 555-0142',
      email: 'jane@example.com',
      address: '14 Maple Drive',
      town: 'Smithtown, NY 11787',
      project: 'Lighting upgrade',
    };

    expect(applyCustomerDetailUpdate({
      customer,
      field: 'address',
      value: '22 Oak Lane',
      signedAt: 'Jul 23, 2026, 8:00 PM',
      signatureContext: 'protected-published',
    })).toEqual({
      customer: {
        ...customer,
        address: '22 Oak Lane',
      },
      signedAt: null,
      signatureContext: null,
    });
    expect(customer.address).toBe('14 Maple Drive');
  });
});
