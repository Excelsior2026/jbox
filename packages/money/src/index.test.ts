import { describe, expect, it } from 'vitest';
import { computeTotals, divRoundHalfUp, CURRENT_MONEY_VERSION } from './index';

const item = (unitPriceCents: number, quantityHundredths: number, taxable: boolean) =>
  ({ unitPriceCents, quantityHundredths, taxable });
const inputs = (discountMillipercent = 0, surchargeCents = 0, taxRateMillipercent = 0) =>
  ({ discountMillipercent, surchargeCents, taxRateMillipercent });

describe('divRoundHalfUp', () => {
  it('rounds a half up', () => {
    expect(divRoundHalfUp(1150n, 100n)).toBe(12); // 11.5 -> 12
    expect(divRoundHalfUp(1149n, 100n)).toBe(11); // 11.49 -> 11
    expect(divRoundHalfUp(1151n, 100n)).toBe(12); // 11.51 -> 12
  });
  it('is exact for whole results', () => {
    expect(divRoundHalfUp(1200n, 100n)).toBe(12);
    expect(divRoundHalfUp(0n, 100n)).toBe(0);
  });
  it('rejects a non-positive denominator', () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow();
  });
});

describe('computeTotals v1', () => {
  it('regression: taxable-discount proportion is exact integer, not float (96 not 97)', () => {
    // subtotal 600c (500 nontaxable + 100 taxable), 3.5% discount
    const t = computeTotals(
      [item(500, 100, false), item(100, 100, true)],
      inputs(3500),
    );
    expect(t.subtotalCents).toBe(600);
    expect(t.taxableSubtotalCents).toBe(100);
    expect(t.discountCents).toBe(21);
    expect(t.taxableAfterDiscountCents).toBe(96); // float path wrongly yields 97
  });

  it('regression: fractional quantity line rounds half up (12 not 11)', () => {
    const t = computeTotals([item(10, 115, false)], inputs()); // 1.15 * 10c = 11.5 -> 12
    expect(t.subtotalCents).toBe(12);
  });

  it('zero subtotal does not divide by zero', () => {
    const t = computeTotals([], inputs(5000, 0, 8625));
    expect(t).toMatchObject({ subtotalCents: 0, taxableAfterDiscountCents: 0, taxCents: 0, totalCents: 0 });
  });

  it('all-nontaxable: tax is zero even with a tax rate', () => {
    const t = computeTotals([item(10000, 100, false)], inputs(0, 0, 8625));
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(10000);
  });

  it('applies surcharge outside discount and tax base', () => {
    const t = computeTotals([item(10000, 100, true)], inputs(0, 5000, 8625));
    expect(t.taxCents).toBe(863); // 10000 * 8.625% = 862.5 -> 863
    expect(t.totalCents).toBe(10000 + 5000 + 863);
  });

  it('clamps discount above 100%', () => {
    const t = computeTotals([item(10000, 100, true)], inputs(150000));
    expect(t.discountCents).toBe(10000);
    expect(t.totalCents).toBe(0);
  });

  it('rejects an unsupported money version', () => {
    expect(() => computeTotals([], inputs(), 999)).toThrow();
  });

  it('exposes the current money version', () => {
    expect(CURRENT_MONEY_VERSION).toBe(1);
  });
});
