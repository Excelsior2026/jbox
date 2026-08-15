import type { Totals } from '@contractor-platform/money';
import type { EstimateStatus, EstimateLinePriceOrigin } from '@/lib/estimate-contract';

export type EstimatePlanMarkerRecord = {
  id: string;
  type: 'outlet' | 'light' | 'switch' | 'equipment';
  x: number;
  y: number;
};

export type EstimateAreaRecord = {
  id: string;
  name: string;
  lengthFt?: number;
  widthFt?: number;
  notes?: string;
  markers?: EstimatePlanMarkerRecord[];
};

export type EstimateLineRecord = {
  id: string;
  position: number;
  itemCode: string;
  description: string;
  itemVersionId: string | null;
  unitPriceCents: number;
  quantityHundredths: number;
  taxable: boolean;
  lineTotalCents: number;
  areaId: string | null;
  priceOrigin: EstimateLinePriceOrigin;
  catalogItemId: string | null;
  releaseId: string | null;
};

export type EstimateCustomerView = {
  name: string;
  phone: string;
  email: string;
  address: string;
  town: string;
  project: string;
};

export type EstimateRecord = {
  id: string;
  displayId: string;
  customerId: string;
  serviceRequestId: string | null;
  jobId: string | null;
  invoiceId: string | null;
  status: EstimateStatus;
  title: string;
  notes: string;
  scope: string;
  exclusions: string;
  discountMillipercent: number;
  surchargeCents: number;
  taxRateMillipercent: number;
  depositCents: number;
  totals: Totals;
  moneyVersion: number;
  documentTemplateVersion: string;
  customer: EstimateCustomerView;
  areas: EstimateAreaRecord[];
  lineItems: EstimateLineRecord[];
  signedByName: string | null;
  signedAt: string | null;
  signatureContext: string | null;
  signatureImage: string | null;
  declinedAt: string | null;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EstimateSummary = {
  id: string;
  displayId: string;
  customerId: string;
  status: EstimateStatus;
  customerName: string;
  title: string;
  town: string;
  totals: Totals;
  createdAt: string;
  updatedAt: string;
};
