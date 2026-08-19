export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'];

export const INVOICE_LIMITS = {
  title: { min: 2, max: 200 },
  notes: { min: 0, max: 4000 },
} as const;

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return status.replace('_', ' ');
}

export type InvoiceStatusColor = {
  background: string;
  text: string;
  dot: string;
};

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, InvoiceStatusColor> = {
  draft: { background: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  issued: { background: '#ecfdf5', text: '#047857', dot: '#10b981' },
  partially_paid: { background: '#fffbeb', text: '#92400e', dot: '#f59e0b' },
  paid: { background: '#d1fae5', text: '#065f46', dot: '#059669' },
  cancelled: { background: '#fef2f2', text: '#991b1b', dot: '#ef4444' },
};

export function invoiceStatusColor(status: InvoiceStatus): InvoiceStatusColor {
  return INVOICE_STATUS_COLORS[status] ?? INVOICE_STATUS_COLORS.draft;
}
