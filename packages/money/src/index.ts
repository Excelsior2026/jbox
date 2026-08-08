export type MoneyLineItem = {
  unitPriceCents: number;      // integer >= 0
  quantityHundredths: number;  // integer >= 0 (quantity * 100)
  taxable: boolean;
};

export type FinancialInputs = {
  discountMillipercent: number; // integer; clamped to [0, 100000]
  surchargeCents: number;       // integer >= 0
  taxRateMillipercent: number;  // integer >= 0
};

export type Totals = {
  subtotalCents: number;
  taxableSubtotalCents: number;
  discountCents: number;
  taxableAfterDiscountCents: number;
  taxCents: number;
  totalCents: number;
};

export const CURRENT_MONEY_VERSION = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Round-half-up division of non-negative integers, computed in BigInt so
// intermediate products cannot overflow 2^53; result is within safe cents range.
export function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error('divRoundHalfUp: denominator must be positive');
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

export function computeTotals(
  lineItems: readonly MoneyLineItem[],
  inputs: FinancialInputs,
  moneyVersion: number = CURRENT_MONEY_VERSION,
): Totals {
  if (moneyVersion !== 1) throw new Error(`computeTotals: unsupported money version ${moneyVersion}`);

  let subtotalCents = 0;
  let taxableSubtotalCents = 0;
  for (const li of lineItems) {
    const lineCents = divRoundHalfUp(BigInt(li.quantityHundredths) * BigInt(li.unitPriceCents), 100n);
    subtotalCents += lineCents;
    if (li.taxable) taxableSubtotalCents += lineCents;
  }

  const discountMillipercent = clamp(Math.trunc(inputs.discountMillipercent), 0, 100000);
  const discountCents = divRoundHalfUp(BigInt(subtotalCents) * BigInt(discountMillipercent), 100000n);

  // Allocate the discount to the taxable base as an exact integer proportion — no float ratio.
  const taxableDiscountCents = subtotalCents > 0
    ? divRoundHalfUp(BigInt(discountCents) * BigInt(taxableSubtotalCents), BigInt(subtotalCents))
    : 0;
  const taxableAfterDiscountCents = Math.max(0, taxableSubtotalCents - taxableDiscountCents);

  const taxRateMillipercent = Math.max(0, Math.trunc(inputs.taxRateMillipercent));
  const taxCents = divRoundHalfUp(BigInt(taxableAfterDiscountCents) * BigInt(taxRateMillipercent), 100000n);

  const surchargeCents = Math.max(0, Math.trunc(inputs.surchargeCents));
  const totalCents = Math.max(0, subtotalCents - discountCents + surchargeCents + taxCents);

  return { subtotalCents, taxableSubtotalCents, discountCents, taxableAfterDiscountCents, taxCents, totalCents };
}
