import type { Totals } from '@contractor-platform/money';
import type { EstimateStatus } from '@/lib/estimate-contract';

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
  lineItems: EstimateLineRecord[];
  signedByName: string | null;
  signedAt: string | null;
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
