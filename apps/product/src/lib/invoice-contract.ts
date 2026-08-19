export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'];

export const INVOICE_LIMITS = {
  title: { min: 2, max: 200 },
  notes: { min: 0, max: 4000 },
} as const;

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return status.replace('_', ' ');
}
