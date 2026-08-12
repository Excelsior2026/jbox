import type { EstimateStatus } from '@/lib/estimate-contract';

export const STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft',
  signed: 'Signed',
  declined: 'Declined',
};

export function money(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function quantity(hundredths: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(hundredths / 100);
}

export function percent(millipercent: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 3,
  }).format(millipercent / 1000);
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value));
}

export function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
