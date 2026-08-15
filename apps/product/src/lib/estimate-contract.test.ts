import { describe, expect, it } from 'vitest';
import { canTransition, validateEstimateDraftInput } from './estimate-contract';

const RELEASE_ITEM_VERSION_ID = '70ffca8f-b2a2-4c96-ad17-77e976ad35e2';

describe('canTransition', () => {
  it('allows draft -> signed and draft -> declined', () => {
    expect(canTransition('draft', 'signed')).toBe(true);
    expect(canTransition('draft', 'declined')).toBe(true);
  });
  it('forbids editing terminal states', () => {
    expect(canTransition('signed', 'draft')).toBe(false);
    expect(canTransition('signed', 'declined')).toBe(false);
    expect(canTransition('declined', 'signed')).toBe(false);
    expect(canTransition('draft', 'draft')).toBe(false);
  });
});

describe('validateEstimateDraftInput', () => {
  const base = () => ({
    customer: { name: 'Jane Smith', phone: '(631) 555-0142', email: '', address: '14 Maple Dr', town: 'Smithtown', project: 'Lighting' },
    scope: '', exclusions: '', notes: '',
    discountMillipercent: 0, surchargeCents: 0, taxRateMillipercent: 8625, depositCents: 0,
    areas: [{ id: 'area-living', name: 'Living room' }],
    lineItems: [{
      itemCode: 'REC-1', description: 'Recessed light', itemVersionId: RELEASE_ITEM_VERSION_ID,
      unitPriceCents: 18500, quantityHundredths: 600, taxable: true,
      areaId: 'area-living', priceOrigin: 'published-price-book', catalogItemId: null, releaseId: null,
    }],
  });

  it('accepts a well-formed draft', () => {
    const r = validateEstimateDraftInput(base());
    expect(r.ok).toBe(true);
  });
  it('rejects non-integer money', () => {
    const r = validateEstimateDraftInput({ ...base(), taxRateMillipercent: 8.625 });
    expect(r.ok).toBe(false);
  });
  it('rejects a negative unit price', () => {
    const bad = base(); bad.lineItems[0].unitPriceCents = -1;
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
  it('rejects a missing customer name', () => {
    const bad = base(); bad.customer.name = '';
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
  it('rejects a customer phone that cannot reach them', () => {
    const bad = base(); bad.customer.phone = '';
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
  it('rejects a malformed itemVersionId', () => {
    const bad = base(); bad.lineItems[0].itemVersionId = 'release-1';
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
  it('accepts a line without a price-book version (technician-custom pricing)', () => {
    const draft = base(); draft.lineItems[0].itemVersionId = null; draft.lineItems[0].priceOrigin = 'technician-custom';
    expect(validateEstimateDraftInput(draft).ok).toBe(true);
  });
  it('rejects a published-price-book line without an item version', () => {
    const bad = base(); bad.lineItems[0].itemVersionId = null;
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
  it('rejects an unknown price origin', () => {
    const bad = base(); bad.lineItems[0].priceOrigin = 'wholesale';
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
  it('rejects an area id that is not listed', () => {
    const bad = base(); bad.lineItems[0].areaId = 'area-basement';
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
  it('accepts an area-less draft', () => {
    const draft = base();
    draft.areas = [];
    draft.lineItems[0].areaId = null;
    expect(validateEstimateDraftInput(draft).ok).toBe(true);
  });
  it('rejects areas that are not an array', () => {
    const bad = base(); bad.areas = 'living' as unknown as typeof bad.areas;
    expect(validateEstimateDraftInput(bad).ok).toBe(false);
  });
});
