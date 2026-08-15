'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { computeTotals, type MoneyLineItem } from '@contractor-platform/money';
import {
  applyCustomerDetailUpdate,
  canDisplayAcceptedSignature,
  canPresentCustomerEstimate,
  isPriceBookReleaseId,
  resolveActiveLinePriceOrigin,
  resolveEditedLinePriceOrigin,
  resolveStoredSignatureContext,
  type EstimateSignatureContext,
  type PriceBookReleaseStatus,
  type PriceBookSource,
} from '@/lib/customer-estimate-presentation';
import type {
  EstimateDraftInput,
  EstimateLinePriceOrigin,
  EstimateStatus,
} from '@/lib/estimate-contract';
import type { EstimateRecord } from '@/lib/estimate-record';
import type { CustomerRecord } from '@/lib/customers';
import type { JobRecord } from '@/lib/job-record';
import EstimateJobAssociation from './estimate-job-association';
import { money } from '../format';
import styles from '../field.module.css';

type PriceBookCategory = {
  code: string;
  name: string;
};

type CatalogItem = {
  id: string;
  catalogItemId?: string;
  versionId?: string;
  releaseId?: string;
  code?: string;
  categoryCode: string;
  category: string;
  name: string;
  detail: string;
  unit: string;
  unitPrice: number;
  taxable: boolean;
  priceOrigin: EstimateLinePriceOrigin;
  popular?: boolean;
};

type PriceBookPayload = {
  book: {
    code: string;
    currency: string;
    releaseId: string;
    release: number;
    status: 'draft' | 'published';
  };
  categories: PriceBookCategory[];
  items: Array<{
    id: string;
    versionId: string;
    code: string;
    legacySlug: string | null;
    categoryCode: string;
    category: string;
    name: string;
    detail: string;
    unit: string;
    unitPriceCents: number;
    taxable: boolean;
    popular: boolean;
  }>;
  nextCursor: string | null;
};

type EstimateItem = CatalogItem & {
  lineId: string;
  areaId: string;
  quantity: number;
  custom?: boolean;
};

type PlanMarkerType = 'outlet' | 'light' | 'switch' | 'equipment';

type PlanMarker = {
  id: string;
  type: PlanMarkerType;
  x: number;
  y: number;
};

type EstimateArea = {
  id: string;
  name: string;
  lengthFt?: number;
  widthFt?: number;
  notes: string;
  markers: PlanMarker[];
};

type Customer = {
  name: string;
  phone: string;
  email: string;
  address: string;
  town: string;
  project: string;
};

const fallbackCategories: PriceBookCategory[] = [
  { code: 'popular', name: 'Popular' },
  { code: 'outlets-switches', name: 'Outlets & switches' },
  { code: 'lighting', name: 'Lighting' },
  { code: 'circuits-panels', name: 'Circuits & panels' },
  { code: 'service', name: 'Service' },
  { code: 'ev-generator', name: 'EV & generator' },
];

const categoryCodeByName = new Map(
  fallbackCategories.slice(1).map((category) => [category.name, category.code]),
);

const starterCatalog: Array<Omit<CatalogItem, 'categoryCode' | 'priceOrigin'>> = [
  { id: 'standard-outlet', category: 'Outlets & switches', name: 'Standard outlet drop', detail: 'New standard receptacle location', unit: 'each', unitPrice: 75, taxable: true, popular: true },
  { id: 'gfci-outlet', category: 'Outlets & switches', name: 'GFCI outlet', detail: 'Ground-fault protected receptacle', unit: 'each', unitPrice: 110, taxable: true, popular: true },
  { id: 'exterior-outlet', category: 'Outlets & switches', name: 'Exterior WR outlet', detail: 'Weather-resistant exterior receptacle', unit: 'each', unitPrice: 145, taxable: true },
  { id: 'dimmer-switch', category: 'Outlets & switches', name: 'Dimmer switch', detail: 'Compatible dimmer and installation', unit: 'each', unitPrice: 95, taxable: true },
  { id: 'recessed-light', category: 'Lighting', name: 'Recessed light', detail: 'Fixture allowance and installation', unit: 'each', unitPrice: 185, taxable: true, popular: true },
  { id: 'ceiling-fan', category: 'Lighting', name: 'Ceiling fan installation', detail: 'Customer-supplied fan, standard conditions', unit: 'each', unitPrice: 225, taxable: true, popular: true },
  { id: 'pendant-light', category: 'Lighting', name: 'Pendant fixture', detail: 'Customer-supplied fixture installation', unit: 'each', unitPrice: 175, taxable: true },
  { id: 'smoke-detector', category: 'Lighting', name: 'Smoke detector', detail: 'Hardwired detector replacement', unit: 'each', unitPrice: 125, taxable: true },
  { id: 'dedicated-circuit', category: 'Circuits & panels', name: 'Dedicated circuit', detail: 'Standard circuit allowance', unit: 'each', unitPrice: 475, taxable: true, popular: true },
  { id: 'subpanel', category: 'Circuits & panels', name: 'Subpanel installation', detail: 'Sample equipment and labor allowance', unit: 'each', unitPrice: 1600, taxable: true },
  { id: 'panel-upgrade', category: 'Circuits & panels', name: 'Panel upgrade', detail: 'Scope requires onsite confirmation', unit: 'each', unitPrice: 2500, taxable: true },
  { id: 'service-call', category: 'Service', name: 'Service call', detail: 'Standard service-call allowance', unit: 'visit', unitPrice: 150, taxable: false, popular: true },
  { id: 'troubleshooting', category: 'Service', name: 'Troubleshooting labor', detail: 'Diagnostic labor allowance', unit: 'hour', unitPrice: 175, taxable: false, popular: true },
  { id: 'emergency-surcharge', category: 'Service', name: 'After-hours surcharge', detail: 'Emergency service premium', unit: 'visit', unitPrice: 250, taxable: false },
  { id: 'permit-allowance', category: 'Service', name: 'Permit allowance', detail: 'Allowance pending final requirements', unit: 'allowance', unitPrice: 300, taxable: false },
  { id: 'ev-circuit', category: 'EV & generator', name: 'EV charger circuit', detail: 'Sample circuit and installation allowance', unit: 'each', unitPrice: 1200, taxable: true, popular: true },
  { id: 'generator-inlet', category: 'EV & generator', name: 'Generator inlet', detail: 'Sample inlet and interlock allowance', unit: 'each', unitPrice: 850, taxable: true },
];

const catalog: CatalogItem[] = starterCatalog.map((item) => ({
  ...item,
  categoryCode: categoryCodeByName.get(item.category) ?? 'service',
  priceOrigin: 'unverified',
}));

const DEFAULT_AREA_ID = 'work-area';

const initialAreas: EstimateArea[] = [
  { id: DEFAULT_AREA_ID, name: 'Work area', notes: '', markers: [] },
];

const initialItems: EstimateItem[] = [];

const DRAFT_STORAGE_KEY = 'jbox-field-estimate';
const CUSTOMER_PRESENTATION_NOTICE = 'Customer review, signature, and print require a published private price book.';

const markerLabels: Record<PlanMarkerType, { short: string; label: string }> = {
  outlet: { short: 'O', label: 'Outlet' },
  light: { short: 'L', label: 'Light' },
  switch: { short: 'S', label: 'Switch' },
  equipment: { short: 'E', label: 'Equipment' },
};

type EstimateApiPayload = {
  estimate?: EstimateRecord;
  delivery?: { status: 'queued'; expiresAt: string };
  error?: string;
  reason?: string;
  retryable?: boolean;
};

async function estimateResponsePayload(response: Response): Promise<EstimateApiPayload> {
  try {
    return await response.json() as EstimateApiPayload;
  } catch {
    return {};
  }
}

function durableDraftStorageKey(estimateId: string) {
  return `${DRAFT_STORAGE_KEY}:${estimateId}`;
}

function restoreAreas(value: unknown, fallback: EstimateArea[] = initialAreas): EstimateArea[] {
  if (!Array.isArray(value)) return fallback;
  const restoredAreas = value.flatMap((candidate: unknown, index: number) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const area = candidate as Partial<EstimateArea>;
    if (typeof area.name !== 'string' || !area.name.trim()) return [];
    const markers: PlanMarker[] = Array.isArray(area.markers)
      ? area.markers.flatMap((markerCandidate: unknown) => {
          if (!markerCandidate || typeof markerCandidate !== 'object') return [];
          const marker = markerCandidate as Partial<PlanMarker>;
          if (
            !marker.type
            || !Object.hasOwn(markerLabels, marker.type)
            || typeof marker.x !== 'number'
            || typeof marker.y !== 'number'
          ) return [];
          return [{
            id: typeof marker.id === 'string' ? marker.id : createId('point'),
            type: marker.type,
            x: Math.min(1, Math.max(0, marker.x)),
            y: Math.min(1, Math.max(0, marker.y)),
          }];
        })
      : [];
    return [{
      id: typeof area.id === 'string' ? area.id : `area-${index + 1}`,
      name: area.name.trim(),
      lengthFt: typeof area.lengthFt === 'number' && area.lengthFt > 0 ? area.lengthFt : undefined,
      widthFt: typeof area.widthFt === 'number' && area.widthFt > 0 ? area.widthFt : undefined,
      notes: typeof area.notes === 'string' ? area.notes : '',
      markers,
    }];
  });
  return restoredAreas.length ? restoredAreas : fallback;
}

function estimatorStateFromRecord(record: EstimateRecord) {
  const areas = restoreAreas(record.areas, [
    { id: 'work-area', name: 'Work area', notes: '', markers: [] },
  ]);
  const fallbackAreaId = areas[0].id;
  const items: EstimateItem[] = record.lineItems.map((item) => ({
    id: item.catalogItemId ?? item.id,
    catalogItemId: item.catalogItemId ?? undefined,
    versionId: item.itemVersionId ?? undefined,
    releaseId: item.releaseId ?? undefined,
    categoryCode: 'service',
    category: 'Service',
    name: item.description,
    detail: '',
    unit: 'each',
    unitPrice: item.unitPriceCents / 100,
    taxable: item.taxable,
    priceOrigin: item.priceOrigin,
    lineId: item.id,
    areaId: item.areaId && areas.some((area) => area.id === item.areaId)
      ? item.areaId
      : fallbackAreaId,
    quantity: item.quantityHundredths / 100,
    custom: item.priceOrigin === 'technician-custom',
  }));

  return {
    areas,
    activeAreaId: fallbackAreaId,
    items,
    customer: record.customer,
    discountPercent: record.discountMillipercent / 1000,
    surcharge: record.surchargeCents / 100,
    taxRate: record.taxRateMillipercent / 1000,
    deposit: record.depositCents / 100,
  };
}

function fallbackCatalogPage(categoryCode: string, search: string) {
  const query = search.trim().toLowerCase();
  return catalog.filter((item) => {
    const inCategory = categoryCode === 'popular' ? item.popular : item.categoryCode === categoryCode;
    const inSearch = !query || `${item.name} ${item.detail} ${item.category} ${item.code ?? ''}`.toLowerCase().includes(query);
    return inCategory && inSearch;
  });
}

function parsePriceBookPayload(value: unknown): PriceBookPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<PriceBookPayload>;
  if (
    !payload.book
    || (payload.book.status !== 'draft' && payload.book.status !== 'published')
    || !isPriceBookReleaseId(payload.book.releaseId)
    || typeof payload.book.release !== 'number'
    || !Array.isArray(payload.categories)
    || !payload.categories.every((category) => category && typeof category.code === 'string' && typeof category.name === 'string')
    || !Array.isArray(payload.items)
    || !payload.items.every((item) => (
      item
      && typeof item.id === 'string'
      && typeof item.versionId === 'string'
      && typeof item.code === 'string'
      && (typeof item.legacySlug === 'string' || item.legacySlug === null)
      && typeof item.categoryCode === 'string'
      && typeof item.category === 'string'
      && typeof item.name === 'string'
      && typeof item.detail === 'string'
      && typeof item.unit === 'string'
      && typeof item.unitPriceCents === 'number'
      && typeof item.taxable === 'boolean'
      && typeof item.popular === 'boolean'
    ))
    || (typeof payload.nextCursor !== 'string' && payload.nextCursor !== null)
  ) return null;

  return payload as PriceBookPayload;
}

function catalogItemsFromPayload(payload: PriceBookPayload): CatalogItem[] {
  return payload.items.map((item) => ({
    id: item.legacySlug ?? item.id,
    catalogItemId: item.id,
    versionId: item.versionId,
    releaseId: payload.book.releaseId,
    code: item.code,
    categoryCode: item.categoryCode,
    category: item.category,
    name: item.name,
    detail: item.detail,
    unit: item.unit,
    unitPrice: item.unitPriceCents / 100,
    taxable: item.taxable,
    priceOrigin: payload.book.status === 'published' ? 'published-price-book' : 'unverified',
    popular: item.popular,
  }));
}

function priceBookRequestUrl(category: string, search: string, cursor?: string) {
  const params = new URLSearchParams({ category, limit: '24' });
  if (search) params.set('q', search);
  if (cursor) params.set('cursor', cursor);
  return `/api/field/price-book?${params.toString()}`;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function Icon({ name }: { name: 'search' | 'plus' | 'minus' | 'trash' | 'save' | 'arrow' | 'edit' | 'check' | 'print' | 'pen' | 'close' | 'estimate' }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    minus: <path d="M5 12h14" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7" /></>,
    save: <><path d="M5 3h12l3 3v15H4V3h1Z" /><path d="M8 3v6h8V3M8 21v-8h8v8" /></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
    edit: <><path d="m4 20 4.2-1 10.5-10.5-3.2-3.2L5 15.8 4 20Z" /><path d="m13.8 7 3.2 3.2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    print: <><path d="M7 9V3h10v6M7 18H4V9h16v9h-3M7 14h10v7H7z" /></>,
    pen: <><path d="M4 19c4-1 5.5-3.8 7.5-7.5L17 6l2 2-5.5 5.5C9.8 15.5 7 17 4 19Z" /><path d="M15.5 7.5 17.5 9.5" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    estimate: <><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h3" /></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function FieldEstimator({
  protectedAccess,
  customerId,
  customerRecord,
  estimateId,
  initial,
}: {
  protectedAccess: boolean;
  /** Create against an existing directory customer instead of a new one. */
  customerId?: string;
  customerRecord?: CustomerRecord;
  estimateId?: string;
  initial?: EstimateRecord;
}) {
  const router = useRouter();
  const draftStorageKey = `${DRAFT_STORAGE_KEY}:new`;
  const [activeRecord, setActiveRecord] = useState<EstimateRecord | null>(initial ?? null);
  const activeEstimateId = estimateId ?? activeRecord?.id ?? null;
  const recordState = initial ? estimatorStateFromRecord(initial) : null;
  const [activeCategory, setActiveCategory] = useState('popular');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(() => fallbackCatalogPage('popular', ''));
  const [priceBookCategories, setPriceBookCategories] = useState<PriceBookCategory[]>(fallbackCategories);
  const [priceBookSource, setPriceBookSource] = useState<PriceBookSource>('connecting');
  const [priceBookReleaseStatus, setPriceBookReleaseStatus] = useState<PriceBookReleaseStatus>('draft');
  const [priceBookReleaseId, setPriceBookReleaseId] = useState<string | null>(null);
  const [priceBookRelease, setPriceBookRelease] = useState<number | null>(null);
  const [priceBookNotice, setPriceBookNotice] = useState('Connecting to the private price book…');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [nextCatalogCursor, setNextCatalogCursor] = useState<string | null>(null);
  const [items, setItems] = useState<EstimateItem[]>(() => recordState?.items ?? initialItems);
  const [areas, setAreas] = useState<EstimateArea[]>(() => recordState?.areas ?? initialAreas);
  const [activeAreaId, setActiveAreaId] = useState(recordState?.activeAreaId ?? DEFAULT_AREA_ID);
  const [areaModalMode, setAreaModalMode] = useState<'add' | 'edit' | null>(null);
  const [areaName, setAreaName] = useState('');
  const [areaLength, setAreaLength] = useState('');
  const [areaWidth, setAreaWidth] = useState('');
  const [plannerOpen, setPlannerOpen] = useState(true);
  const [markerType, setMarkerType] = useState<PlanMarkerType>('outlet');
  const [customer, setCustomer] = useState<Customer>(() => recordState?.customer ?? {
    name: customerRecord?.name ?? '',
    phone: customerRecord?.phone ?? '',
    email: customerRecord?.email ?? '',
    address: customerRecord?.address ?? '',
    town: customerRecord?.town ?? '',
    project: '',
  });
  const [customerEditing, setCustomerEditing] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(recordState?.discountPercent ?? 0);
  const [surcharge, setSurcharge] = useState(recordState?.surcharge ?? 0);
  const [taxRate, setTaxRate] = useState(recordState?.taxRate ?? 0);
  const [deposit, setDeposit] = useState(recordState?.deposit ?? 0);
  const [scope, setScope] = useState(initial?.scope ?? '');
  const [exclusions, setExclusions] = useState(initial?.exclusions ?? '');
  const [internalNotes, setInternalNotes] = useState(initial?.notes ?? '');
  const [customOpen, setCustomOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureStarted, setSignatureStarted] = useState(false);
  const [signerName, setSignerName] = useState(initial?.signedByName ?? customer.name);
  const [signedAt, setSignedAt] = useState<string | null>(initial?.signedAt ?? null);
  const [signatureContext, setSignatureContext] = useState<EstimateSignatureContext | null>(
    resolveStoredSignatureContext(initial?.signatureContext),
  );
  const [recordStatus, setRecordStatus] = useState<EstimateStatus>(initial?.status ?? 'draft');
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(initial?.updatedAt ?? '');
  const [jobId, setJobId] = useState<string | null>(initial?.jobId ?? null);
  const [saveState, setSaveState] = useState('Save draft');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [hasConflict, setHasConflict] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState(0);
  const [customQuantity, setCustomQuantity] = useState(1);
  const [customTaxable, setCustomTaxable] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const safeFocusRef = useRef<HTMLButtonElement>(null);
  const drawingRef = useRef(false);
  const reviewOpenRef = useRef(false);
  const catalogQueryRef = useRef('popular\u0000');
  const catalogLoadingMoreRef = useRef(false);
  const durableEstimate = Boolean(activeEstimateId && activeRecord);
  const estimateLocked = durableEstimate && recordStatus !== 'draft';
  const activeLinePriceOrigins = items.map((item) => resolveActiveLinePriceOrigin({
    priceOrigin: item.priceOrigin,
    lineReleaseId: item.releaseId,
    activeReleaseId: priceBookReleaseId,
  }));
  const unverifiedLineCount = activeLinePriceOrigins.filter((origin) => origin === 'unverified').length;
  const publishedDatabasePriceBook = priceBookSource === 'database' && priceBookReleaseStatus === 'published';
  const customerEstimatePresentationAllowed = canPresentCustomerEstimate({
    protectedAccess,
    priceBookSource,
    priceBookReleaseStatus,
    linePriceOrigins: activeLinePriceOrigins,
  });
  const acceptedSignatureVisible = canDisplayAcceptedSignature({
    protectedAccess,
    signedAt,
    signatureContext,
  });
  const customerPresentationNotice = unverifiedLineCount > 0
    ? publishedDatabasePriceBook
      ? `${unverifiedLineCount} estimate ${unverifiedLineCount === 1 ? 'line uses' : 'lines use'} unverified pricing. Remove and re-add ${unverifiedLineCount === 1 ? 'it' : 'them'} from the published price book, or replace ${unverifiedLineCount === 1 ? 'it' : 'them'} with explicit custom work before customer review, signature, or print.`
      : `${CUSTOMER_PRESENTATION_NOTICE} ${unverifiedLineCount} estimate ${unverifiedLineCount === 1 ? 'line also uses' : 'lines also use'} unverified pricing.`
    : CUSTOMER_PRESENTATION_NOTICE;

  useEffect(() => {
    if (estimateId || initial) return;
    const hydrateDraft = window.setTimeout(() => {
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(draftStorageKey);
      } catch {
        return;
      }
      if (!raw) return;
      try {
        const draft = JSON.parse(raw);
        if (!draft || typeof draft !== 'object') return;
        const nextAreas = restoreAreas(draft.areas);
        const fallbackAreaId = nextAreas[0].id;
        setAreas(nextAreas);
        setActiveAreaId(typeof draft.activeAreaId === 'string' && nextAreas.some((area) => area.id === draft.activeAreaId) ? draft.activeAreaId : fallbackAreaId);
        if (Array.isArray(draft.items)) {
          setItems(draft.items.flatMap((candidate: unknown, index: number) => {
            if (!candidate || typeof candidate !== 'object') return [];
            const item = candidate as Partial<EstimateItem>;
            if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.quantity !== 'number' || typeof item.unitPrice !== 'number') return [];
            const areaId = typeof item.areaId === 'string' && nextAreas.some((area) => area.id === item.areaId) ? item.areaId : fallbackAreaId;
            return [{
              ...item,
              categoryCode: typeof item.categoryCode === 'string'
                ? item.categoryCode
                : categoryCodeByName.get(String(item.category ?? '')) ?? 'service',
              priceOrigin: item.priceOrigin === 'published-price-book' || item.priceOrigin === 'technician-custom' || item.priceOrigin === 'unverified'
                ? item.priceOrigin
                : 'unverified',
              lineId: typeof item.lineId === 'string' ? item.lineId : `legacy-${item.id}-${index}`,
              areaId,
            } as EstimateItem];
          }));
        }
        if (draft.customer && typeof draft.customer === 'object') setCustomer(draft.customer);
        if (typeof draft.discountPercent === 'number') setDiscountPercent(draft.discountPercent);
        if (typeof draft.surcharge === 'number') setSurcharge(draft.surcharge);
        if (typeof draft.taxRate === 'number') setTaxRate(draft.taxRate);
        if (typeof draft.deposit === 'number') setDeposit(draft.deposit);
        if (typeof draft.scope === 'string') setScope(draft.scope);
        if (typeof draft.exclusions === 'string') setExclusions(draft.exclusions);
        if (typeof draft.internalNotes === 'string') setInternalNotes(draft.internalNotes);
        if (typeof draft.signerName === 'string') setSignerName(draft.signerName);
        if (typeof draft.signedAt === 'string') {
          setSignedAt(draft.signedAt);
          setSignatureContext(resolveStoredSignatureContext(draft.signatureContext));
        } else if (draft.signedAt === null) {
          setSignedAt(null);
          setSignatureContext(null);
        }
      } catch {
        // Corrupted draft — ignore and keep an empty working draft.
      }
    }, 0);

    return () => window.clearTimeout(hydrateDraft);
  }, [draftStorageKey, estimateId, initial]);

  useEffect(() => {
    const debounce = window.setTimeout(() => setDebouncedSearch(search.trim()), 260);
    return () => window.clearTimeout(debounce);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const queryKey = `${activeCategory}\u0000${debouncedSearch}`;
    catalogQueryRef.current = queryKey;

    async function loadPriceBook() {
      setCatalogLoading(true);
      setCatalogItems([]);
      setNextCatalogCursor(null);
      setPriceBookSource('connecting');
      setPriceBookReleaseId(null);
      setPriceBookNotice('Loading the private price book…');
      if (protectedAccess) {
        const restoreFocus = reviewOpenRef.current;
        reviewOpenRef.current = false;
        setReviewOpen(false);
        setSignatureOpen(false);
        setSignatureStarted(false);
        drawingRef.current = false;
        if (restoreFocus) window.requestAnimationFrame(() => safeFocusRef.current?.focus());
      }

      try {
        const response = await fetch(priceBookRequestUrl(activeCategory, debouncedSearch), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Price-book request failed with ${response.status}.`);

        const payload = parsePriceBookPayload(await response.json());
        if (!payload) throw new Error('Price-book response was invalid.');
        if (controller.signal.aborted) return;

        setCatalogItems(catalogItemsFromPayload(payload));
        setPriceBookCategories([
          { code: 'popular', name: 'Popular' },
          ...payload.categories.filter((category) => category.code !== 'popular'),
        ]);
        setNextCatalogCursor(payload.nextCursor);
        setPriceBookSource('database');
        setPriceBookReleaseStatus(payload.book.status);
        setPriceBookReleaseId(payload.book.releaseId);
        setPriceBookRelease(payload.book.release);
        setPriceBookNotice(
          payload.book.status === 'published'
            ? `Private price book · release ${payload.book.release}`
            : `Private price book · release ${payload.book.release} draft`,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Using the offline starter price book.', error);
        setCatalogItems(fallbackCatalogPage(activeCategory, debouncedSearch));
        setPriceBookCategories(fallbackCategories);
        setNextCatalogCursor(null);
        setPriceBookSource('offline');
        setPriceBookReleaseStatus('draft');
        setPriceBookReleaseId(null);
        setPriceBookRelease(null);
        setPriceBookNotice('Database unavailable · using the offline starter price book');
      } finally {
        if (!controller.signal.aborted) setCatalogLoading(false);
      }
    }

    void loadPriceBook();
    return () => controller.abort();
  }, [activeCategory, debouncedSearch, protectedAccess]);

  const activeArea = areas.find((area) => area.id === activeAreaId) ?? areas[0] ?? initialAreas[0];
  const activeAreaItems = items.filter((item) => item.areaId === activeArea.id);
  const activeAreaSubtotal = activeAreaItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const roomAspectRatio = activeArea.lengthFt && activeArea.widthFt
    ? Math.min(2.2, Math.max(.75, activeArea.lengthFt / activeArea.widthFt))
    : 1.35;

  const totals = useMemo(() => {
    const lines: MoneyLineItem[] = items.map((item) => ({
      unitPriceCents: Math.round(item.unitPrice * 100),
      quantityHundredths: Math.round(item.quantity * 100),
      taxable: item.taxable,
    }));
    return computeTotals(lines, {
      discountMillipercent: Math.round(Math.min(Math.max(discountPercent, 0), 100) * 1000),
      surchargeCents: Math.round(Math.max(surcharge, 0) * 100),
      taxRateMillipercent: Math.round(Math.max(taxRate, 0) * 1000),
    });
  }, [items, discountPercent, surcharge, taxRate]);

  const subtotal = totals.subtotalCents / 100;
  const discountAmount = totals.discountCents / 100;
  const taxAmount = totals.taxCents / 100;
  const total = totals.totalCents / 100;
  const balance = Math.max(0, total - Math.max(deposit, 0));

  function updateCustomerDetail<TField extends keyof Customer>(field: TField, value: Customer[TField]) {
    const updatedDraft = applyCustomerDetailUpdate({
      customer,
      field,
      value,
      signedAt,
      signatureContext,
    });
    setCustomer(updatedDraft.customer);
    setSignedAt(updatedDraft.signedAt);
    setSignatureContext(updatedDraft.signatureContext);
  }

  function clearAcceptedSignature() {
    setSignedAt(null);
    setSignatureContext(null);
  }

  function addItem(catalogItem: CatalogItem) {
    setItems((current) => {
      const existing = current.find((item) => item.id === catalogItem.id && item.areaId === activeArea.id);
      // Re-tapping an item that is already on this area only bumps the quantity.
      // Do NOT re-spread catalogItem: that would silently overwrite the tech's
      // per-line unit-price, taxable edits, and price provenance with catalog defaults.
      if (existing) return current.map((item) => item.lineId === existing.lineId
        ? { ...item, quantity: item.quantity + 1 }
        : item);
      return [...current, { ...catalogItem, lineId: createId('line'), areaId: activeArea.id, quantity: 1 }];
    });
    clearAcceptedSignature();
  }

  async function loadMoreCatalogItems() {
    if (!nextCatalogCursor || catalogLoadingMoreRef.current) return;
    const requestQueryKey = `${activeCategory}\u0000${debouncedSearch}`;
    const previousPriceBookState = {
      source: priceBookSource,
      releaseStatus: priceBookReleaseStatus,
      releaseId: priceBookReleaseId,
      release: priceBookRelease,
    };
    let releaseMismatch = false;
    catalogLoadingMoreRef.current = true;
    setCatalogLoadingMore(true);
    setPriceBookSource('connecting');
    setPriceBookReleaseId(null);
    setPriceBookNotice('Checking the private price book…');
    if (protectedAccess) {
      const restoreFocus = reviewOpenRef.current;
      reviewOpenRef.current = false;
      setReviewOpen(false);
      setSignatureOpen(false);
      setSignatureStarted(false);
      drawingRef.current = false;
      if (restoreFocus) window.requestAnimationFrame(() => safeFocusRef.current?.focus());
    }

    try {
      const response = await fetch(
        priceBookRequestUrl(activeCategory, debouncedSearch, nextCatalogCursor),
        { cache: 'no-store' },
      );
      if (!response.ok) {
        if (response.status === 409 && catalogQueryRef.current === requestQueryKey) {
          releaseMismatch = true;
          setNextCatalogCursor(null);
          setPriceBookNotice('Price book updated · choose a category to refresh');
        }
        throw new Error(`Price-book request failed with ${response.status}.`);
      }
      const payload = parsePriceBookPayload(await response.json());
      if (!payload) throw new Error('Price-book response was invalid.');
      if (catalogQueryRef.current !== requestQueryKey) return;
      if (payload.book.releaseId !== previousPriceBookState.releaseId) {
        releaseMismatch = true;
        setNextCatalogCursor(null);
        setPriceBookNotice('Price book updated · choose a category to refresh');
        throw new Error('The price book changed while loading more items.');
      }
      const additionalItems = catalogItemsFromPayload(payload);
      setCatalogItems((current) => {
        const currentIds = new Set(current.map((item) => item.catalogItemId ?? item.id));
        return [...current, ...additionalItems.filter((item) => !currentIds.has(item.catalogItemId ?? item.id))];
      });
      setNextCatalogCursor(payload.nextCursor);
      setPriceBookSource('database');
      setPriceBookReleaseStatus(payload.book.status);
      setPriceBookReleaseId(payload.book.releaseId);
      setPriceBookRelease(payload.book.release);
      setPriceBookNotice(
        payload.book.status === 'published'
          ? `Private price book · release ${payload.book.release}`
          : `Private price book · release ${payload.book.release} draft`,
      );
    } catch (error) {
      if (catalogQueryRef.current !== requestQueryKey) return;
      console.warn('Additional price-book items could not be loaded.', error);
      if (releaseMismatch) return;
      setPriceBookSource(previousPriceBookState.source);
      setPriceBookReleaseStatus(previousPriceBookState.releaseStatus);
      setPriceBookReleaseId(previousPriceBookState.releaseId);
      setPriceBookRelease(previousPriceBookState.release);
      setPriceBookNotice('More items could not be loaded · try again');
    } finally {
      catalogLoadingMoreRef.current = false;
      setCatalogLoadingMore(false);
    }
  }

  function updateItem(lineId: string, update: Partial<Omit<EstimateItem, 'priceOrigin'>>) {
    setItems((current) => current.map((item) => {
      if (item.lineId !== lineId) return item;
      const priceOrigin = resolveEditedLinePriceOrigin({
        priceOrigin: item.priceOrigin,
        unitPrice: item.unitPrice,
        taxable: item.taxable,
        update,
      });
      return { ...item, ...update, priceOrigin };
    }));
    clearAcceptedSignature();
  }

  function removeItem(lineId: string) {
    setItems((current) => current.filter((item) => item.lineId !== lineId));
    clearAcceptedSignature();
  }

  function changeQuantity(lineId: string, change: number) {
    setItems((current) => current
      .map((item) => item.lineId === lineId ? { ...item, quantity: Math.max(0, item.quantity + change) } : item)
      .filter((item) => item.quantity > 0));
    clearAcceptedSignature();
  }

  function addCustomItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = customName.trim();
    const quantity = Math.max(1, Math.round(Number(customQuantity) || 0));
    if (!trimmedName || !(customPrice >= 0) || customQuantity < 1) return;
    setItems((current) => [...current, {
      id: `custom-${Date.now()}`,
      lineId: createId('line'),
      areaId: activeArea.id,
      categoryCode: 'service',
      category: 'Service',
      name: trimmedName,
      detail: 'Custom estimate item',
      unit: 'each',
      unitPrice: customPrice,
      quantity,
      taxable: customTaxable,
      priceOrigin: 'technician-custom',
      custom: true,
    }]);
    setCustomName('');
    setCustomPrice(0);
    setCustomQuantity(1);
    setCustomTaxable(true);
    setCustomOpen(false);
    clearAcceptedSignature();
  }

  function currentEstimateDraft(): EstimateDraftInput {
    return {
      customer,
      scope,
      exclusions,
      notes: internalNotes,
      discountMillipercent: Math.round(Math.min(Math.max(discountPercent, 0), 100) * 1000),
      surchargeCents: Math.round(Math.max(surcharge, 0) * 100),
      taxRateMillipercent: Math.round(Math.max(taxRate, 0) * 1000),
      depositCents: Math.round(Math.max(deposit, 0) * 100),
      areas,
      lineItems: items.map((item, index) => ({
        itemCode: item.code ?? '',
        description: item.name,
        itemVersionId: item.versionId ?? null,
        unitPriceCents: Math.round(Math.max(item.unitPrice, 0) * 100),
        quantityHundredths: Math.round(Math.max(item.quantity, 0) * 100),
        taxable: item.taxable,
        priceOrigin: activeLinePriceOrigins[index] ?? 'unverified',
        areaId: item.areaId || null,
        catalogItemId: item.catalogItemId ?? null,
        releaseId: item.releaseId ?? null,
      })),
    };
  }

  function writeDurableOfflineBuffer(draft: EstimateDraftInput, updatedAt: string) {
    if (!activeEstimateId) return false;
    try {
      window.localStorage.setItem(
        durableDraftStorageKey(activeEstimateId),
        JSON.stringify({
          draft,
          expectedUpdatedAt: updatedAt,
          savedAt: new Date().toISOString(),
        }),
      );
      return true;
    } catch {
      // localStorage can throw: private mode, storage disabled, or quota exceeded.
      return false;
    }
  }

  function applyServerRecord(record: EstimateRecord) {
    setRecordStatus(record.status);
    setExpectedUpdatedAt(record.updatedAt);
    setSignerName(record.signedByName ?? record.customer.name);
    setSignedAt(record.signedAt);
    setSignatureContext(
      record.signatureContext ? resolveStoredSignatureContext(record.signatureContext) : null,
    );
  }

  async function persistDurableDraft(announce = true): Promise<EstimateRecord | null> {
    if (!activeEstimateId || !expectedUpdatedAt || recordStatus !== 'draft') return null;
    const draft = currentEstimateDraft();
    const buffered = writeDurableOfflineBuffer(draft, expectedUpdatedAt);
    if (announce) {
      setSaveState('Saving…');
      setActionError('');
      setActionMessage('');
      setHasConflict(false);
    }

    try {
      const response = await fetch(`/api/field/estimates/${encodeURIComponent(activeEstimateId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, expectedUpdatedAt }),
      });
      const payload = await estimateResponsePayload(response);
      if (!response.ok || !payload.estimate) {
        const conflicted = response.status === 409 && payload.reason === 'conflict';
        setHasConflict(conflicted);
        setActionError(payload.error || 'The estimate could not be saved.');
        if (announce) setSaveState(conflicted ? 'Reload required' : 'Save failed');
        return null;
      }

      applyServerRecord(payload.estimate);
      writeDurableOfflineBuffer(draft, payload.estimate.updatedAt);
      setHasConflict(false);
      setActionError('');
      if (announce) {
        setSaveState(buffered ? 'Saved to server' : 'Saved · no device backup');
        setActionMessage('The server record and this device are up to date.');
      }
      return payload.estimate;
    } catch {
      setHasConflict(false);
      setActionError(
        buffered
          ? 'The server could not be reached. Your edits remain in this estimate’s offline backup on this device.'
          : 'The server could not be reached, and this browser could not store an offline backup.',
      );
      if (announce) setSaveState(buffered ? 'Offline backup saved' : 'Save failed');
      return null;
    }
  }

  async function prepareJobAssociation() {
    if (!activeEstimateId || !expectedUpdatedAt || recordStatus === 'declined') return null;
    if (recordStatus !== 'draft') return expectedUpdatedAt;
    const saved = await persistDurableDraft(false);
    return saved?.updatedAt ?? null;
  }

  function applyJobAssociation(record: EstimateRecord, job: JobRecord) {
    applyServerRecord(record);
    setJobId(record.jobId);
    setActionError('');
    setHasConflict(false);
    setActionMessage(`Estimate linked to ${job.displayId}. The association is now immutable.`);
  }

  async function saveDraft() {
    if (activeEstimateId) {
      if (recordStatus !== 'draft') {
        setActionError('This estimate is locked. Duplicate it to make a revised draft.');
        return;
      }
      setActionBusy(true);
      await persistDurableDraft();
      setActionBusy(false);
      return;
    }

    await createDurableEstimate();
  }

  async function createDurableEstimate(): Promise<EstimateRecord | null> {
    if (actionBusy) return null;
    const draft = currentEstimateDraft();
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify({
        customer,
        items,
        areas,
        activeAreaId,
        discountPercent,
        surcharge,
        taxRate,
        deposit,
        scope,
        exclusions,
        internalNotes,
        signedAt,
        signerName,
        signatureContext,
      }));
    } catch {
      // localStorage can throw; the draft is still submitted below.
    }

    setActionBusy(true);
    setActionError('');
    setActionMessage('');
    setSaveState('Creating…');
    try {
      const body = customerId
        ? { customerId, draft }
        : {
            newCustomer: {
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              address: customer.address,
              town: customer.town,
            },
            draft,
          };
      const response = await fetch('/api/field/estimates', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await estimateResponsePayload(response);
      if (!response.ok || !payload.estimate) {
        throw new Error(payload.error || 'The estimate could not be created.');
      }

      const record = payload.estimate;
      setActiveRecord(record);
      applyServerRecord(record);
      writeDurableOfflineBuffer(draft, record.updatedAt);
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // Ignore storage cleanup failures.
      }
      window.history.replaceState(window.history.state, '', `/field/estimates/${encodeURIComponent(record.id)}`);
      setSaveState('Saved to server');
      setActionMessage('The estimate draft is now a server record.');
      return record;
    } catch (error) {
      setSaveState('Save failed');
      setActionError(error instanceof Error ? error.message : 'The estimate could not be created.');
      return null;
    } finally {
      setActionBusy(false);
    }
  }

  async function declineDurableEstimate() {
    if (!activeEstimateId || recordStatus !== 'draft' || actionBusy) return;
    if (!window.confirm('Mark this estimate declined? It will be locked and can only be revised by duplicating it.')) return;

    setActionBusy(true);
    setActionError('');
    setActionMessage('');
    const saved = await persistDurableDraft(false);
    if (!saved) {
      setActionBusy(false);
      return;
    }

    try {
      const response = await fetch(`/api/field/estimates/${encodeURIComponent(activeEstimateId)}/decline`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const payload = await estimateResponsePayload(response);
      if (!response.ok || !payload.estimate) {
        throw new Error(payload.error || 'The estimate could not be marked declined.');
      }
      applyServerRecord(payload.estimate);
      setCustomerEditing(false);
      closeCustomerReview();
      setActionMessage('Estimate marked declined and locked.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The estimate could not be marked declined.');
    } finally {
      setActionBusy(false);
    }
  }

  async function sendDurableEstimate() {
    if (!activeEstimateId || recordStatus !== 'draft' || actionBusy) return;
    if (!customer.email.trim()) {
      setActionError('Add the customer email address before delivery.');
      return;
    }
    if (!window.confirm(`Create an immutable version and queue it for ${customer.email}?`)) {
      return;
    }

    setActionBusy(true);
    setActionError('');
    setActionMessage('');
    const saved = await persistDurableDraft(false);
    if (!saved) {
      setActionBusy(false);
      return;
    }
    try {
      const response = await fetch(
        `/api/field/estimates/${encodeURIComponent(activeEstimateId)}/delivery`,
        {
          method: 'POST',
          credentials: 'same-origin',
        },
      );
      const payload = await estimateResponsePayload(response);
      if (!response.ok || !payload.estimate) {
        throw new Error(payload.error || 'The estimate could not be prepared for delivery.');
      }
      applyServerRecord(payload.estimate);
      setActionMessage(
        'This estimate version is immutable and queued for delivery. Email delivery is not confirmed until the outbox reports success.',
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The estimate could not be prepared for delivery.',
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function duplicateDurableEstimate() {
    if (!activeEstimateId || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    setActionMessage('');

    if (recordStatus === 'draft') {
      const saved = await persistDurableDraft(false);
      if (!saved) {
        setActionBusy(false);
        return;
      }
    }

    try {
      const response = await fetch(`/api/field/estimates/${encodeURIComponent(activeEstimateId)}/duplicate`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const payload = await estimateResponsePayload(response);
      if (!response.ok || !payload.estimate) {
        throw new Error(payload.error || 'The estimate could not be duplicated.');
      }
      router.push(`/field/estimates/${encodeURIComponent(payload.estimate.id)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The estimate could not be duplicated.');
      setActionBusy(false);
    }
  }

  function openAddArea() {
    setAreaName('');
    setAreaLength('');
    setAreaWidth('');
    setAreaModalMode('add');
  }

  function openEditArea() {
    setAreaName(activeArea.name);
    setAreaLength(activeArea.lengthFt ? String(activeArea.lengthFt) : '');
    setAreaWidth(activeArea.widthFt ? String(activeArea.widthFt) : '');
    setAreaModalMode('edit');
  }

  function saveArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = areaName.trim();
    if (!name) return;
    const lengthFt = Number(areaLength) > 0 ? Number(areaLength) : undefined;
    const widthFt = Number(areaWidth) > 0 ? Number(areaWidth) : undefined;

    if (areaModalMode === 'edit') {
      setAreas((current) => current.map((area) => area.id === activeArea.id ? { ...area, name, lengthFt, widthFt } : area));
    } else {
      const newArea: EstimateArea = { id: createId('area'), name, lengthFt, widthFt, notes: '', markers: [] };
      setAreas((current) => [...current, newArea]);
      setActiveAreaId(newArea.id);
      setPlannerOpen(true);
    }

    setAreaModalMode(null);
    clearAcceptedSignature();
  }

  function deleteActiveArea() {
    if (areas.length <= 1) return;
    const itemCount = activeAreaItems.reduce((sum, item) => sum + item.quantity, 0);
    const confirmation = window.confirm(`Delete ${activeArea.name}${itemCount ? ` and its ${itemCount} estimate item${itemCount === 1 ? '' : 's'}` : ''}?`);
    if (!confirmation) return;
    const remainingAreas = areas.filter((area) => area.id !== activeArea.id);
    setAreas(remainingAreas);
    setItems((current) => current.filter((item) => item.areaId !== activeArea.id));
    setActiveAreaId(remainingAreas[0].id);
    setAreaModalMode(null);
    clearAcceptedSignature();
  }

  function updateActiveArea(update: Partial<EstimateArea>) {
    setAreas((current) => current.map((area) => area.id === activeArea.id ? { ...area, ...update } : area));
    clearAcceptedSignature();
  }

  function placePlanMarker(event: PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(.97, Math.max(.03, (event.clientX - rect.left) / rect.width));
    const y = Math.min(.95, Math.max(.05, (event.clientY - rect.top) / rect.height));
    updateActiveArea({ markers: [...activeArea.markers, { id: createId('point'), type: markerType, x, y }] });
  }

  function removePlanMarker(markerId: string) {
    updateActiveArea({ markers: activeArea.markers.filter((marker) => marker.id !== markerId) });
  }

  function openCustomerReview() {
    if (!customerEstimatePresentationAllowed) return;
    reviewOpenRef.current = true;
    setReviewOpen(true);
  }

  function closeCustomerReview() {
    reviewOpenRef.current = false;
    setReviewOpen(false);
    setSignatureOpen(false);
  }

  function printCustomerEstimate() {
    if (!customerEstimatePresentationAllowed) return;
    window.print();
  }

  function openSignatureCollection() {
    if (!customerEstimatePresentationAllowed) return;
    setSignatureStarted(false);
    setSignatureOpen(true);
  }

  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startSignature(event: PointerEvent<HTMLCanvasElement>) {
    if (!customerEstimatePresentationAllowed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    setSignatureStarted(true);
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function drawSignature(event: PointerEvent<HTMLCanvasElement>) {
    if (!customerEstimatePresentationAllowed || !drawingRef.current || !canvasRef.current) return;
    const context = canvasRef.current.getContext('2d');
    if (!context) return;
    const point = canvasPoint(event);
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#10283b';
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopSignature() {
    drawingRef.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureStarted(false);
  }

  async function acceptSignature() {
    if (!customerEstimatePresentationAllowed || !signatureStarted || !signerName.trim()) return;
    const signatureImage = canvasRef.current?.toDataURL('image/png');
    if (!signatureImage) {
      setActionError('The signature could not be captured. Please clear it and try again.');
      return;
    }

    const wasDurable = Boolean(activeEstimateId);
    let recordId = activeEstimateId;
    if (!recordId) {
      const record = await createDurableEstimate();
      if (!record) return;
      recordId = record.id;
    }
    if (recordStatus !== 'draft' || actionBusy) return;

    setActionBusy(true);
    setActionError('');
    setActionMessage('');
    if (wasDurable) {
      // A fresh create already persisted the draft; an existing record needs
      // the latest edits flushed before its snapshot is locked and signed.
      const saved = await persistDurableDraft(false);
      if (!saved) {
        setActionBusy(false);
        return;
      }
    }

    try {
      const response = await fetch(`/api/field/estimates/${encodeURIComponent(recordId)}/sign`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signatureImage,
        }),
      });
      const payload = await estimateResponsePayload(response);
      if (!response.ok || !payload.estimate) {
        throw new Error(payload.error || 'The signature could not be accepted.');
      }
      applyServerRecord(payload.estimate);
      setSignatureOpen(false);
      setActionMessage('Customer signature accepted. This estimate is now locked.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The signature could not be accepted.');
    } finally {
      setActionBusy(false);
    }
  }

  const statusLabel = recordStatus === 'signed' ? 'Signed' : recordStatus === 'declined' ? 'Declined' : 'Draft';

  return (
    <div className={styles.estimator}>
      <div className={styles.estimatorToolbar}>
        <div className={styles.estimateIdentity}>
          <span>Estimate</span>
          <strong>{activeEstimateId ?? 'Unsaved draft'}</strong>
          <i className={recordStatus === 'signed' || acceptedSignatureVisible
            ? styles.signedStatus
            : recordStatus === 'declined'
              ? styles.declinedStatus
              : ''}>
            {statusLabel}
          </i>
        </div>
        <div className={styles.topActions}>
          <span className={styles.syncState}><i /> {activeEstimateId ? 'Server record' : 'Local draft'}</span>
          <button
            className={`${styles.secondaryAction} ${styles.saveEstimateAction}`}
            type="button"
            disabled={actionBusy || estimateLocked}
            aria-label={estimateLocked ? 'Save unavailable for locked estimate' : 'Save estimate'}
            onClick={saveDraft}
          >
            <Icon name="save" />{actionBusy ? 'Working…' : saveState}
          </button>
          <button
            className={styles.primaryAction}
            type="button"
            disabled={!customerEstimatePresentationAllowed || recordStatus === 'declined'}
            aria-label="Review estimate"
            aria-describedby={!customerEstimatePresentationAllowed ? 'customer-presentation-gate-notice' : undefined}
            title={!customerEstimatePresentationAllowed ? customerPresentationNotice : undefined}
            onClick={openCustomerReview}
          >
            Review estimate <Icon name="arrow" />
          </button>
        </div>
      </div>

      <section className={styles.jobBar} aria-label="Customer and job details">
        <div className={styles.jobContext}>
          <span className={styles.customerAvatar}>
            {customer.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join('') || '—'}
          </span>
          <div><small>Customer & job</small><strong>{customer.name} · {customer.project}</strong><p>{customer.address}, {customer.town}</p></div>
        </div>
        <button
          ref={safeFocusRef}
          type="button"
          disabled={estimateLocked}
          onClick={() => setCustomerEditing((value) => !value)}
        >
          <Icon name="edit" /> Edit details
        </button>
      </section>

      {activeEstimateId && initial && (
        <EstimateJobAssociation
          estimateId={activeEstimateId}
          customerId={initial.customerId}
          serviceRequestId={initial.serviceRequestId}
          jobId={jobId}
          estimateStatus={recordStatus}
          defaultTitle={customer.project}
          prepareAssociation={prepareJobAssociation}
          onAssociated={applyJobAssociation}
        />
      )}

      {durableEstimate && (
        <section className={styles.recordActions} aria-label="Estimate record actions">
          <div>
            <strong>{recordStatus === 'draft' ? 'Working draft' : `Locked ${recordStatus} estimate`}</strong>
            <span>{recordStatus === 'draft'
              ? 'Saves update the shared server record and a per-estimate backup on this device.'
              : 'Duplicate this record to create an editable revision.'}</span>
          </div>
          <div>
            {recordStatus === 'draft' && (
              <>
                <button type="button" disabled={actionBusy} onClick={sendDurableEstimate}>
                  Send to customer
                </button>
                <button type="button" disabled={actionBusy} onClick={declineDurableEstimate}>
                  Mark declined
                </button>
              </>
            )}
            <button type="button" disabled={actionBusy} onClick={duplicateDurableEstimate}>
              Duplicate estimate
            </button>
          </div>
        </section>
      )}

      {actionMessage && <p className={styles.recordMessage} role="status">{actionMessage}</p>}
      {actionError && (
        <p className={styles.recordError} role="alert">
          <span>{actionError}</span>
          {hasConflict && <button type="button" onClick={() => window.location.reload()}>Reload estimate</button>}
        </p>
      )}

      <fieldset className={styles.editorFieldset} disabled={estimateLocked}>
        {customerEditing && (
          <section className={styles.customerEditor} aria-label="Edit customer details">
            <label>Customer name<input value={customer.name} onChange={(event) => updateCustomerDetail('name', event.target.value)} /></label>
            <label>Phone<input value={customer.phone} onChange={(event) => updateCustomerDetail('phone', event.target.value)} /></label>
            <label>Email<input value={customer.email} onChange={(event) => updateCustomerDetail('email', event.target.value)} /></label>
            <label>Service address<input value={customer.address} onChange={(event) => updateCustomerDetail('address', event.target.value)} /></label>
            <label>Town / ZIP<input value={customer.town} onChange={(event) => updateCustomerDetail('town', event.target.value)} /></label>
            <label>Project name<input value={customer.project} onChange={(event) => updateCustomerDetail('project', event.target.value)} /></label>
            <button type="button" onClick={() => setCustomerEditing(false)}><Icon name="check" /> Done</button>
          </section>
        )}

        {!customerEstimatePresentationAllowed && (
          <p className={styles.presentationGateNotice} id="customer-presentation-gate-notice" role="status">
            <strong>Customer presentation unavailable.</strong>
            <span>
              {customerPresentationNotice}{' '}
              {estimateLocked
                ? 'This locked record remains available for reference.'
                : activeEstimateId
                  ? 'Editing and server draft saves remain available.'
                  : 'Editing and local draft saves remain available.'}
            </span>
          </p>
        )}

        <section className={styles.areaRail} aria-label="Estimate rooms and work areas">
          <div className={styles.areaRailIntro}>
            <span>Walkthrough areas</span>
            <strong>Choose where you’re adding work</strong>
          </div>
          <div className={styles.areaTabs} role="tablist" aria-label="Rooms and work areas">
            {areas.map((area) => {
              const roomItems = items.filter((item) => item.areaId === area.id);
              const roomQuantity = roomItems.reduce((sum, item) => sum + item.quantity, 0);
              const roomSubtotal = roomItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
              return (
                <button
                  className={area.id === activeArea.id ? styles.activeArea : ''}
                  type="button"
                  role="tab"
                  aria-selected={area.id === activeArea.id}
                  key={area.id}
                  onClick={() => setActiveAreaId(area.id)}
                >
                  <span><strong>{area.name}</strong><small>{area.lengthFt && area.widthFt ? `${area.lengthFt}′ × ${area.widthFt}′` : 'Dimensions optional'}</small></span>
                  <span><strong>{roomQuantity}</strong><small>{money(roomSubtotal)}</small></span>
                </button>
              );
            })}
          </div>
          <button className={styles.addAreaButton} type="button" aria-label="Add area" onClick={openAddArea}><Icon name="plus" /><span>Add area</span></button>
        </section>

        <div className={styles.builder}>
          <aside className={styles.catalogPane}>
            <div className={styles.paneHeading}>
              <div><span>Adding to {activeArea.name}</span><h1>Price book</h1></div>
              <small>{catalogLoading || catalogLoadingMore
                ? 'Loading'
                : priceBookSource === 'connecting'
                  ? 'Pricing check required'
                  : priceBookSource === 'database'
                    ? (priceBookReleaseStatus === 'published' ? 'Published pricing' : 'Draft pricing')
                    : 'Offline copy'}</small>
            </div>
            <label className={styles.searchBox}>
              <Icon name="search" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search services" aria-label="Search price book" />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><Icon name="close" /></button>}
            </label>
            <div className={styles.categoryTabs} aria-label="Service categories">
              {priceBookCategories.map((category) => (
                <button className={activeCategory === category.code ? styles.activeCategory : ''} key={category.code} type="button" onClick={() => setActiveCategory(category.code)}>{category.name}</button>
              ))}
            </div>
            <div className={`${styles.catalogStatus} ${priceBookSource === 'offline' ? styles.catalogStatusOffline : ''}`} aria-live="polite">
              <i />
              <span>{priceBookNotice}</span>
            </div>
            <div className={styles.catalogList}>
              {catalogItems.map((item) => {
                const quantity = items.find((estimateItem) => estimateItem.id === item.id && estimateItem.areaId === activeArea.id)?.quantity || 0;
                return (
                  <button className={styles.catalogItem} type="button" key={item.id} onClick={() => addItem(item)}>
                    <span><strong>{item.name}</strong><small>{item.detail}{item.code ? ` · ${item.code}` : ''}</small></span>
                    <span className={styles.catalogPrice}><strong>{money(item.unitPrice)}</strong><small>per {item.unit}</small></span>
                    <span className={quantity ? styles.addedBadge : styles.addButton}>{quantity ? `${quantity} added` : <Icon name="plus" />}</span>
                  </button>
                );
              })}
              {catalogLoading && <p className={styles.emptyCatalog}>Loading price-book items…</p>}
              {!catalogLoading && !catalogItems.length && <p className={styles.emptyCatalog}>No price-book items match this search.</p>}
            </div>
            {nextCatalogCursor && (
              <button className={styles.loadMoreCatalog} type="button" disabled={catalogLoadingMore} onClick={loadMoreCatalogItems}>
                {catalogLoadingMore ? 'Loading more…' : 'Load more items'}
              </button>
            )}
            <button className={styles.customItemButton} type="button" onClick={() => setCustomOpen(true)}><Icon name="plus" /> Add custom item</button>
          </aside>

          <section className={styles.estimatePane}>
            <div className={styles.paneHeading}>
              <div><span>{customer.project}</span><h2>{activeArea.name}</h2></div>
              <div className={styles.itemCount}><strong>{activeAreaItems.reduce((sum, item) => sum + item.quantity, 0)}</strong><small>in area · {money(activeAreaSubtotal)}</small></div>
            </div>

            <section className={styles.roomPlanner} aria-labelledby="room-planner-title">
              <div className={styles.roomPlannerHeader}>
                <div><span>Optional room sketch</span><strong id="room-planner-title">{activeArea.name} plan</strong></div>
                <div>
                  <button type="button" onClick={openEditArea}><Icon name="edit" /> Room details</button>
                  <button type="button" onClick={() => setPlannerOpen((open) => !open)}>{plannerOpen ? 'Hide sketch' : `Open sketch · ${activeArea.markers.length} points`}</button>
                </div>
              </div>
              {plannerOpen && (
                <div className={styles.roomPlannerBody}>
                  <div className={styles.planTools}>
                    <div className={styles.roomDimensions}>
                      <span>Room size</span>
                      <strong>{activeArea.lengthFt && activeArea.widthFt ? `${activeArea.lengthFt}′ × ${activeArea.widthFt}′` : 'Not measured'}</strong>
                      <small>The sketch works with or without dimensions.</small>
                    </div>
                    <div className={styles.markerPalette} aria-label="Plan point type">
                      <span>Tap point type</span>
                      {Object.entries(markerLabels).map(([type, marker]) => (
                        <button className={markerType === type ? styles.activeMarkerType : ''} type="button" key={type} onClick={() => setMarkerType(type as PlanMarkerType)}>
                          <i>{marker.short}</i>{marker.label}
                        </button>
                      ))}
                    </div>
                    <label className={styles.areaNotes}>Area notes<textarea rows={3} value={activeArea.notes} onChange={(event) => updateActiveArea({ notes: event.target.value })} placeholder="Access, wall conditions, customer requests…" /></label>
                    {activeArea.markers.length > 0 && <button className={styles.clearMarkers} type="button" onClick={() => updateActiveArea({ markers: [] })}>Clear all points</button>}
                  </div>
                  <div className={styles.planStage}>
                    <p>Choose a symbol, then tap its location. Tap a placed point to remove it.</p>
                    <div className={styles.roomOutlineWrap}>
                      <div
                        className={styles.roomOutline}
                        style={{ aspectRatio: roomAspectRatio, width: `min(100%, ${Math.round(330 * roomAspectRatio)}px)` }}
                        role="application"
                        tabIndex={0}
                        aria-label={`${activeArea.name} room sketch. Tap to add ${markerLabels[markerType].label.toLowerCase()} point.`}
                        onPointerDown={placePlanMarker}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          updateActiveArea({ markers: [...activeArea.markers, { id: createId('point'), type: markerType, x: .5, y: .5 }] });
                        }}
                      >
                        <span className={styles.roomNameLabel}>{activeArea.name}</span>
                        {activeArea.lengthFt && <span className={styles.lengthLabel}>{activeArea.lengthFt}′</span>}
                        {activeArea.widthFt && <span className={styles.widthLabel}>{activeArea.widthFt}′</span>}
                        {activeArea.markers.map((marker, index) => (
                          <button
                            className={`${styles.planMarker} ${styles[`marker_${marker.type}`]}`}
                            type="button"
                            key={marker.id}
                            style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => removePlanMarker(marker.id)}
                            aria-label={`Remove ${markerLabels[marker.type].label} point ${index + 1}`}
                            title={`Remove ${markerLabels[marker.type].label} point`}
                          >
                            {markerLabels[marker.type].short}<small>{index + 1}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.planLegend}>
                      {Object.entries(markerLabels).map(([type, marker]) => <span key={type}><i className={styles[`marker_${type}`]}>{marker.short}</i>{marker.label}</span>)}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <div className={styles.lineItems}>
              <div className={styles.lineHeader}><span>Service item</span><span>Quantity</span><span>Unit price</span><span>Total</span><span /></div>
              {activeAreaItems.map((item) => (
                <div className={styles.lineItem} key={item.lineId}>
                  <div className={styles.lineDescription}>
                    <strong>{item.name}{item.custom && <i>Custom</i>}</strong>
                    <div className={styles.lineMeta}>
                      <label><input type="checkbox" checked={item.taxable} onChange={(event) => updateItem(item.lineId, { taxable: event.target.checked })} /> Taxable</label>
                      {areas.length > 1 && <select aria-label={`${item.name} area`} value={item.areaId} onChange={(event) => updateItem(item.lineId, { areaId: event.target.value })}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>}
                    </div>
                  </div>
                  <div className={styles.quantityControl}>
                    <button type="button" onClick={() => changeQuantity(item.lineId, -1)} aria-label={`Decrease ${item.name} quantity`}><Icon name="minus" /></button>
                    <input aria-label={`${item.name} quantity`} type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(item.lineId, { quantity: Math.max(1, Math.round(Number(event.target.value) || 0)) })} />
                    <button type="button" onClick={() => changeQuantity(item.lineId, 1)} aria-label={`Increase ${item.name} quantity`}><Icon name="plus" /></button>
                  </div>
                  <label className={styles.priceInput}><span>$</span><input aria-label={`${item.name} unit price`} type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(item.lineId, { unitPrice: Math.max(0, Number(event.target.value)) })} /></label>
                  <strong className={styles.lineTotal}>{money(item.quantity * item.unitPrice)}</strong>
                  <button className={styles.deleteItem} type="button" onClick={() => removeItem(item.lineId)} aria-label={`Remove ${item.name}`}><Icon name="trash" /></button>
                </div>
              ))}
              {!activeAreaItems.length && <div className={styles.emptyEstimate}><Icon name="estimate" /><strong>No work in {activeArea.name}</strong><span>Select an item from the price book to add it to this area.</span></div>}
            </div>

            <div className={styles.estimateDetails}>
              <div className={styles.scopeFields}>
                <label>Scope of work<textarea value={scope} onChange={(event) => { setScope(event.target.value); clearAcceptedSignature(); }} rows={5} /></label>
                <label>Exclusions & conditions<textarea value={exclusions} onChange={(event) => { setExclusions(event.target.value); clearAcceptedSignature(); }} rows={4} /></label>
                <label className={styles.internalField}>Internal notes <span>Not customer-facing</span><textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} rows={3} /></label>
              </div>
              <aside className={styles.totalsPanel}>
                <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
                <label><span>Discount</span><span className={styles.compactInput}><input aria-label="Discount percent" type="number" min="0" max="100" value={discountPercent} onChange={(event) => { setDiscountPercent(Number(event.target.value)); clearAcceptedSignature(); }} /><i>%</i></span></label>
                <label><span>Surcharge</span><span className={styles.compactInput}><i>$</i><input aria-label="Surcharge amount" type="number" min="0" step="0.01" value={surcharge} onChange={(event) => { setSurcharge(Number(event.target.value)); clearAcceptedSignature(); }} /></span></label>
                <label><span>Tax rate</span><span className={styles.compactInput}><input aria-label="Tax rate" type="number" min="0" step="0.001" value={taxRate} onChange={(event) => { setTaxRate(Number(event.target.value)); clearAcceptedSignature(); }} /><i>%</i></span></label>
                <div className={styles.taxLine}><span>Calculated tax</span><strong>{money(taxAmount)}</strong></div>
                <div className={styles.estimateTotal}><span>Estimated total</span><strong>{money(total)}</strong></div>
                <label><span>Deposit required</span><span className={styles.compactInput}><i>$</i><input aria-label="Deposit required" type="number" min="0" step="0.01" value={deposit} onChange={(event) => { setDeposit(Number(event.target.value)); clearAcceptedSignature(); }} /></span></label>
                <div className={styles.balanceLine}><span>Balance after deposit</span><strong>{money(balance)}</strong></div>
                <small>{priceBookReleaseStatus === 'published' && priceBookSource === 'database'
                  ? `Price-book release ${priceBookRelease ?? ''}; confirm final scope and onsite conditions.`
                  : 'Price-book values are drafts pending owner approval.'}</small>
              </aside>
            </div>
          </section>
        </div>
      </fieldset>

      {areaModalMode && (
        <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAreaModalMode(null); }}>
          <form className={styles.smallModal} onSubmit={saveArea} role="dialog" aria-modal="true" aria-labelledby="area-modal-title">
            <div className={styles.modalHeader}><div><span>Walkthrough area</span><h2 id="area-modal-title">{areaModalMode === 'add' ? 'Add a room or area' : `Edit ${activeArea.name}`}</h2></div><button type="button" onClick={() => setAreaModalMode(null)} aria-label="Close"><Icon name="close" /></button></div>
            <label>Room or area name<input required autoFocus value={areaName} maxLength={60} onChange={(event) => setAreaName(event.target.value)} placeholder="Example: Living room or Suite 204" /></label>
            <div className={styles.modalFormRow}>
              <label>Length in feet <span>Optional</span><input type="number" min="1" max="500" step="0.5" value={areaLength} onChange={(event) => setAreaLength(event.target.value)} placeholder="18" /></label>
              <label>Width in feet <span>Optional</span><input type="number" min="1" max="500" step="0.5" value={areaWidth} onChange={(event) => setAreaWidth(event.target.value)} placeholder="12" /></label>
            </div>
            <p className={styles.modalNote}>Dimensions shape the simple room rectangle, but neither dimensions nor a sketch are required.</p>
            <div className={styles.areaModalActions}>
              {areaModalMode === 'edit' && areas.length > 1 && <button className={styles.deleteAreaButton} type="button" onClick={deleteActiveArea}><Icon name="trash" /> Delete area</button>}
              <button className={styles.primaryAction} type="submit">{areaModalMode === 'add' ? 'Add area' : 'Save room details'} <Icon name="check" /></button>
            </div>
          </form>
        </div>
      )}

      {customOpen && (
        <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomOpen(false); }}>
          <form className={styles.smallModal} onSubmit={addCustomItem} role="dialog" aria-modal="true" aria-labelledby="custom-item-title">
            <div className={styles.modalHeader}><div><span>{activeArea.name}</span><h2 id="custom-item-title">Add custom work</h2></div><button type="button" onClick={() => setCustomOpen(false)} aria-label="Close"><Icon name="close" /></button></div>
            <label>Item name<input required autoFocus value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Example: Custom material allowance" /></label>
            <div className={styles.modalFormRow}>
              <label>Quantity<input required type="number" min="1" step="1" value={customQuantity} onChange={(event) => setCustomQuantity(Number(event.target.value))} /></label>
              <label>Unit price<input required type="number" min="0" step="0.01" value={customPrice} onChange={(event) => setCustomPrice(Number(event.target.value))} /></label>
            </div>
            <label className={styles.modalCheckbox}><input type="checkbox" checked={customTaxable} onChange={(event) => setCustomTaxable(event.target.checked)} /> This item is taxable</label>
            <button className={styles.primaryAction} type="submit">Add to estimate <Icon name="plus" /></button>
          </form>
        </div>
      )}

      {reviewOpen && customerEstimatePresentationAllowed && (
        <div className={styles.modalOverlay} role="presentation">
          <section className={`${styles.reviewModal} ${styles.printableEstimate}`} role="dialog" aria-modal="true" aria-labelledby="review-title">
            <div className={styles.modalHeader}>
              <div><span>Customer review</span><h2 id="review-title">Estimate {activeEstimateId ?? 'Unsaved draft'}</h2></div>
              <button type="button" onClick={closeCustomerReview} aria-label="Close"><Icon name="close" /></button>
            </div>
            <div className={styles.reviewParties}>
              <div><small>Prepared for</small><strong>{customer.name}</strong><span>{customer.address}<br />{customer.town}</span></div>
            </div>
            <div className={styles.reviewScope}><small>Scope of work</small><p>{scope}</p></div>
            <div className={styles.reviewAreas}>
              {areas.map((area) => {
                const roomItems = items.filter((item) => item.areaId === area.id);
                if (!roomItems.length && !area.notes && !area.markers.length) return null;
                const reviewAspectRatio = area.lengthFt && area.widthFt ? Math.min(2.2, Math.max(.75, area.lengthFt / area.widthFt)) : 1.35;
                return (
                  <section className={styles.reviewArea} key={area.id}>
                    <div className={styles.reviewAreaHeader}>
                      <span><small>Room / area</small><strong>{area.name}</strong></span>
                      <span>{area.lengthFt && area.widthFt ? `${area.lengthFt}′ × ${area.widthFt}′` : `${roomItems.reduce((sum, item) => sum + item.quantity, 0)} items`}</span>
                    </div>
                    <div className={styles.reviewLines}>
                      {roomItems.map((item) => <div key={item.lineId}><span><strong>{item.name}</strong><small>{item.quantity} × {money(item.unitPrice)}</small></span><strong>{money(item.quantity * item.unitPrice)}</strong></div>)}
                    </div>
                    {area.notes && <p className={styles.reviewAreaNotes}><strong>Area notes</strong>{area.notes}</p>}
                    {area.markers.length > 0 && (
                      <div className={styles.reviewPlanRow}>
                        <div className={styles.reviewPlan} style={{ aspectRatio: reviewAspectRatio }}>
                          <span>{area.name}</span>
                          {area.markers.map((marker, index) => <i className={styles[`marker_${marker.type}`]} key={marker.id} style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}>{markerLabels[marker.type].short}<small>{index + 1}</small></i>)}
                        </div>
                        <p><strong>Plan points</strong>{area.markers.map((marker, index) => `${index + 1} ${markerLabels[marker.type].label}`).join(' · ')}</p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            <div className={styles.reviewFinancials}>
              <span>Subtotal <strong>{money(subtotal)}</strong></span>
              {discountAmount > 0 && <span>Discount <strong>−{money(discountAmount)}</strong></span>}
              {surcharge > 0 && <span>Surcharge <strong>{money(surcharge)}</strong></span>}
              {taxAmount > 0 && <span>Tax <strong>{money(taxAmount)}</strong></span>}
              <span className={styles.reviewTotal}>Estimated total <strong>{money(total)}</strong></span>
            </div>
            {(priceBookReleaseStatus !== 'published' || priceBookSource !== 'database') && (
              <p className={styles.reviewTerms} style={{ color: '#8a3b12', fontWeight: 600 }} role="note">
                Draft pricing — these figures use a price book that is pending owner approval and are not a final quote.
              </p>
            )}
            <div className={styles.reviewTerms}><small>Exclusions & conditions</small><p>{exclusions}</p></div>

            {signatureOpen ? (
              <div className={styles.signatureSection}>
                <div>
                  <span>Customer signature</span>
                  <small>{activeEstimateId
                    ? 'Accepting this signature locks the estimate. Duplicate it to make revisions.'
                    : 'Signature preview — final authorization workflow pending.'}</small>
                </div>
                <label>Signer’s full name<input value={signerName} onChange={(event) => setSignerName(event.target.value)} /></label>
                <canvas
                  ref={canvasRef}
                  width="900"
                  height="220"
                  onPointerDown={startSignature}
                  onPointerMove={drawSignature}
                  onPointerUp={stopSignature}
                  onPointerCancel={stopSignature}
                  aria-label="Signature area"
                />
                <div className={styles.signatureActions}>
                  <button type="button" disabled={actionBusy} onClick={clearSignature}>Clear</button>
                  <button
                    className={styles.primaryAction}
                    type="button"
                    disabled={actionBusy || !signatureStarted || !signerName.trim()}
                    onClick={acceptSignature}
                  >
                    {actionBusy ? 'Saving & signing…' : 'Accept signature'} <Icon name="check" />
                  </button>
                </div>
              </div>
            ) : acceptedSignatureVisible ? (
              <div className={styles.signedConfirmation}><Icon name="check" /><span><strong>Customer signature captured</strong>{signerName} · {signedAt}</span></div>
            ) : null}

            <div className={styles.reviewFooter}>
              <button className={styles.secondaryAction} type="button" onClick={printCustomerEstimate}><Icon name="print" /> Print / save PDF</button>
              <span>Review every line with the customer before collecting approval.</span>
              {!signatureOpen && !acceptedSignatureVisible && <button className={styles.primaryAction} type="button" onClick={openSignatureCollection}>Collect signature <Icon name="pen" /></button>}
              {acceptedSignatureVisible && !activeEstimateId && <button className={styles.primaryAction} type="button" onClick={saveDraft}>Save signed draft <Icon name="save" /></button>}
            </div>
          </section>
        </div>
      )}

      <div className={styles.estimatorFooter}>
        <Link className={styles.buttonGhost} href={activeEstimateId ? `/field/estimates/${activeEstimateId}` : '/field/estimates'}>
          {activeEstimateId ? 'View estimate record' : 'Discard draft'}
        </Link>
      </div>
    </div>
  );
}
