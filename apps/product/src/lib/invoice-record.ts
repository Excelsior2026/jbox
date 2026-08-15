import type { Totals } from '@contractor-platform/money';
import type { InvoiceStatus } from '@/lib/invoice-contract';

export type InvoiceRecord = {
  id: string;
  displayId: string;
  estimateId: string | null;
  jobId: string | null;
  customerId: string;
  customerName: string;
  status: InvoiceStatus;
  title: string;
  notes: string;
  dueAt: string | null;
  discountMillipercent: number;
  surchargeCents: number;
  taxRateMillipercent: number;
  depositCents: number;
  totals: Totals;
  moneyVersion: number;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceSummary = Pick<
  InvoiceRecord,
  | 'id'
  | 'displayId'
  | 'estimateId'
  | 'jobId'
  | 'customerId'
  | 'customerName'
  | 'status'
  | 'title'
  | 'totals'
  | 'createdAt'
  | 'updatedAt'
>;
