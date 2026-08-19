import { describe, expect, it } from 'vitest';
import {
  INVOICE_LIMITS,
  INVOICE_STATUSES,
  invoiceStatusLabel,
} from './invoice-contract';

describe('invoice-contract', () => {
  it('defines the jbox invoice statuses', () => {
    expect(INVOICE_STATUSES).toEqual(['draft', 'issued', 'partially_paid', 'paid', 'cancelled']);
  });

  it('keeps title and notes limits aligned with the invoices CHECKs', () => {
    expect(INVOICE_LIMITS.title.min).toBe(2);
    expect(INVOICE_LIMITS.title.max).toBe(200);
    expect(INVOICE_LIMITS.notes.max).toBe(4000);
  });

  it('labels statuses for display', () => {
    expect(invoiceStatusLabel('partially_paid')).toBe('partially paid');
  });
});
