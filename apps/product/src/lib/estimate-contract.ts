import { CUSTOMER_LIMITS } from './customer-contract';

export type EstimateStatus = 'draft' | 'signed' | 'declined';

const TRANSITIONS: Record<EstimateStatus, ReadonlySet<EstimateStatus>> = {
  draft: new Set<EstimateStatus>(['signed', 'declined']),
  signed: new Set<EstimateStatus>(),
  declined: new Set<EstimateStatus>(),
};

export function canTransition(from: EstimateStatus, to: EstimateStatus): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

export type EstimateLineInput = {
  itemCode: string;
  description: string;
  itemVersionId: string | null;
  unitPriceCents: number;
  quantityHundredths: number;
  taxable: boolean;
};

export type EstimateDraftInput = {
  customer: { name: string; phone: string; email: string; address: string; town: string; project: string };
  scope: string; exclusions: string; notes: string;
  discountMillipercent: number; surchargeCents: number; taxRateMillipercent: number; depositCents: number;
  lineItems: EstimateLineInput[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;
const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const isNullableUuid = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && UUID_PATTERN.test(v));

export function validateEstimateDraftInput(
  value: unknown,
): { ok: true; value: EstimateDraftInput } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'Body must be an object.' };
  const v = value as Record<string, unknown>;
  const c = v.customer as Record<string, unknown> | undefined;
  // Lengths come from CUSTOMER_LIMITS so they cannot drift from the `customers`
  // CHECK constraints. The *requiredness* here is deliberately stricter than the
  // customer directory's: a directory entry may have no phone, but an estimate
  // priced for a customer must be reachable, so phone is mandatory below.
  const { name: NAME, phone: PHONE, email: EMAIL, address: ADDRESS, town: TOWN } = CUSTOMER_LIMITS;
  if (!c || !isStr(c.name, NAME.min, NAME.max)) return { ok: false, error: 'Customer name is required.' };
  if (!isStr(c.phone, 1, PHONE.max)) return { ok: false, error: 'Customer phone is required.' };
  if (typeof c.email !== 'string' || c.email.length > EMAIL.max) return { ok: false, error: 'Customer email is invalid.' };
  // `project` becomes estimates.title (CHECK 2..200), so it is estimate-scoped,
  // required, and has no shared `customers` limit of its own.
  for (const [k, lo, hi] of [
    ['address', 0, ADDRESS.max],
    ['town', 0, TOWN.max],
    ['project', 2, 200],
  ] as const) {
    if (!isStr(c[k], lo, hi)) return { ok: false, error: `Customer ${k} is invalid.` };
  }
  for (const k of ['discountMillipercent', 'surchargeCents', 'taxRateMillipercent', 'depositCents'] as const) {
    if (!isNonNegInt(v[k])) return { ok: false, error: `${k} must be a non-negative integer.` };
  }
  if ((v.discountMillipercent as number) > 100000) return { ok: false, error: 'discountMillipercent out of range.' };
  // scope, exclusions (005), and notes (002) all cap at 4000.
  for (const k of ['scope', 'exclusions', 'notes'] as const) {
    if (typeof v[k] !== 'string' || (v[k] as string).length > 4000) return { ok: false, error: `${k} is invalid.` };
  }
  if (!Array.isArray(v.lineItems)) return { ok: false, error: 'lineItems must be an array.' };
  for (const raw of v.lineItems as unknown[]) {
    const li = raw as Record<string, unknown>;
    if (!isStr(li.itemCode, 0, 40)) return { ok: false, error: 'Line item code is invalid.' };
    // description: BETWEEN 1 AND 500 in estimate_line_items.
    if (!isStr(li.description, 1, 500)) return { ok: false, error: 'Line item description is required.' };
    if (!isNonNegInt(li.unitPriceCents) || !isNonNegInt(li.quantityHundredths)) {
      return { ok: false, error: 'Line item amounts must be non-negative integers.' };
    }
    if (typeof li.taxable !== 'boolean' || !isNullableUuid(li.itemVersionId)) {
      return { ok: false, error: 'Line item flags are invalid.' };
    }
  }
  return { ok: true, value: value as EstimateDraftInput };
}
