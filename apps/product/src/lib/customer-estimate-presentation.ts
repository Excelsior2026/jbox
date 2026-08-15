import type { EstimateLinePriceOrigin } from '@/lib/estimate-contract';

export type PriceBookSource = 'connecting' | 'database' | 'offline';

export type PriceBookReleaseStatus = 'draft' | 'published';

export type EstimateSignatureContext = 'protected-published' | 'demo' | 'legacy';

const PRICE_BOOK_RELEASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StoredEstimateLinePriceOrigin = {
  priceOrigin?: unknown;
  custom?: unknown;
  catalogItemId?: unknown;
  versionId?: unknown;
  releaseId?: unknown;
};

export type CustomerEstimatePresentationContext = {
  protectedAccess: boolean;
  priceBookSource: PriceBookSource;
  priceBookReleaseStatus: PriceBookReleaseStatus;
  linePriceOrigins: readonly EstimateLinePriceOrigin[];
};

export function isPriceBookReleaseId(value: unknown): value is string {
  return typeof value === 'string' && PRICE_BOOK_RELEASE_ID_PATTERN.test(value);
}

export function priceBookReleaseSnapshotMatches(
  expected: { releaseId: unknown; status: unknown },
  current: { releaseId: unknown; status: unknown },
) {
  return isPriceBookReleaseId(expected.releaseId)
    && isPriceBookReleaseId(current.releaseId)
    && expected.releaseId === current.releaseId
    && (expected.status === 'draft' || expected.status === 'published')
    && expected.status === current.status;
}

export function canPresentCustomerEstimate({
  protectedAccess,
  priceBookSource,
  priceBookReleaseStatus,
  linePriceOrigins,
}: CustomerEstimatePresentationContext) {
  if (!protectedAccess) return true;

  return priceBookSource === 'database'
    && priceBookReleaseStatus === 'published'
    && linePriceOrigins.every((origin) => (
      origin === 'published-price-book' || origin === 'technician-custom'
    ));
}

export function resolveStoredLinePriceOrigin({
  priceOrigin,
  custom,
}: StoredEstimateLinePriceOrigin): EstimateLinePriceOrigin {
  if (priceOrigin === 'technician-custom' && custom === true) return 'technician-custom';

  return 'unverified';
}

export function resolveActiveLinePriceOrigin({
  priceOrigin,
  lineReleaseId,
  activeReleaseId,
}: {
  priceOrigin: EstimateLinePriceOrigin;
  lineReleaseId: unknown;
  activeReleaseId: unknown;
}): EstimateLinePriceOrigin {
  if (priceOrigin === 'technician-custom') return 'technician-custom';
  if (
    priceOrigin === 'published-price-book'
    && isPriceBookReleaseId(lineReleaseId)
    && isPriceBookReleaseId(activeReleaseId)
    && lineReleaseId === activeReleaseId
  ) return 'published-price-book';

  return 'unverified';
}

export function resolveEditedLinePriceOrigin({
  priceOrigin,
  unitPrice,
  taxable,
  update,
}: {
  priceOrigin: EstimateLinePriceOrigin;
  unitPrice: number;
  taxable: boolean;
  update: {
    unitPrice?: unknown;
    taxable?: unknown;
    [key: string]: unknown;
  };
}): EstimateLinePriceOrigin {
  if (priceOrigin === 'technician-custom') return 'technician-custom';

  const changedPrice = Object.hasOwn(update, 'unitPrice') && update.unitPrice !== unitPrice;
  const changedTaxable = Object.hasOwn(update, 'taxable') && update.taxable !== taxable;

  return changedPrice || changedTaxable ? 'unverified' : priceOrigin;
}

export function canDisplayAcceptedSignature({
  protectedAccess,
  signedAt,
  signatureContext,
}: {
  protectedAccess: boolean;
  signedAt: unknown;
  signatureContext: unknown;
}) {
  if (typeof signedAt !== 'string' || !signedAt.trim()) return false;
  if (!protectedAccess) return true;

  return signatureContext === 'protected-published';
}

export function resolveStoredSignatureContext(value: unknown): EstimateSignatureContext {
  if (value === 'protected-published' || value === 'demo' || value === 'legacy') return value;

  return 'legacy';
}

export function applyCustomerDetailUpdate<
  TCustomer extends object,
  TField extends keyof TCustomer,
>(update: {
  customer: TCustomer;
  field: TField;
  value: TCustomer[TField];
  signedAt: unknown;
  signatureContext: unknown;
}): {
  customer: TCustomer;
  signedAt: null;
  signatureContext: null;
} {
  return {
    customer: { ...update.customer, [update.field]: update.value } as TCustomer,
    signedAt: null,
    signatureContext: null,
  };
}
