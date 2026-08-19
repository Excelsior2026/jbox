export type ChangeOrderStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export const CHANGE_ORDER_STATUSES: readonly ChangeOrderStatus[] = [
  'draft', 'pending_approval', 'approved', 'rejected',
];

export type ChangeOrderLineAction = 'add' | 'modify' | 'remove';

export const CHANGE_ORDER_LINE_ACTIONS: readonly ChangeOrderLineAction[] = [
  'add', 'modify', 'remove',
];

export const CHANGE_ORDER_LIMITS = {
  title: { min: 2, max: 200 },
  notes: { min: 0, max: 4000 },
  reason: { min: 0, max: 1000 },
  rejectionReason: { min: 0, max: 500 },
} as const;

export type ChangeOrderLineInput = {
  position: number;
  itemCode: string;
  description: string;
  itemVersionId: string | null;
  quantityHundredths: number;
  unitPriceCents: number;
  taxable: boolean;
  action: ChangeOrderLineAction;
  originalLineItemId: string | null;
};

export type ChangeOrderInput = {
  title: string;
  notes: string;
  reason: string;
  lineItems: ChangeOrderLineInput[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;
const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const isNullableUuid = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && UUID_PATTERN.test(v));

export function validateChangeOrderInput(
  value: unknown,
): { ok: true; value: ChangeOrderInput } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'Body must be an object.' };
  const v = value as Record<string, unknown>;

  const { title: TITLE, notes: NOTES, reason: REASON } = CHANGE_ORDER_LIMITS;

  if (!isStr(v.title, TITLE.min, TITLE.max)) {
    return { ok: false, error: `Title must be between ${TITLE.min} and ${TITLE.max} characters.` };
  }
  if (!isStr(v.notes, NOTES.min, NOTES.max)) {
    return { ok: false, error: `Notes must be at most ${NOTES.max} characters.` };
  }
  if (!isStr(v.reason, REASON.min, REASON.max)) {
    return { ok: false, error: `Reason must be at most ${REASON.max} characters.` };
  }

  if (!Array.isArray(v.lineItems) || v.lineItems.length === 0) {
    return { ok: false, error: 'At least one line item is required.' };
  }

  const actionSet = new Set<string>(CHANGE_ORDER_LINE_ACTIONS);

  for (const raw of v.lineItems as unknown[]) {
    const li = raw as Record<string, unknown>;

    if (!isInt(li.position) || li.position <= 0) {
      return { ok: false, error: 'Line item position must be a positive integer.' };
    }
    if (!isStr(li.itemCode, 0, 40)) {
      return { ok: false, error: 'Line item code is invalid.' };
    }
    if (!isStr(li.description, 1, 300)) {
      return { ok: false, error: 'Line item description is required.' };
    }
    if (!isNonNegInt(li.unitPriceCents) || !isNonNegInt(li.quantityHundredths)) {
      return { ok: false, error: 'Line item amounts must be non-negative integers.' };
    }
    if (typeof li.taxable !== 'boolean') {
      return { ok: false, error: 'Line item taxable flag is invalid.' };
    }
    if (typeof li.action !== 'string' || !actionSet.has(li.action)) {
      return { ok: false, error: 'Line item action is invalid.' };
    }
    if (!isNullableUuid(li.itemVersionId) || !isNullableUuid(li.originalLineItemId)) {
      return { ok: false, error: 'Line item references are invalid.' };
    }
  }

  return { ok: true, value: value as ChangeOrderInput };
}
