import { describe, expect, it } from 'vitest';
import { CUSTOMER_LIMITS, validateCustomerInput } from './customer-contract';

const valid = () => ({
  name: 'Jane Smith',
  phone: '(631) 555-0142',
  email: 'jane@example.com',
  address: '14 Maple Dr',
  town: 'Smithtown',
});

describe('CUSTOMER_LIMITS', () => {
  // These must mirror the CHECK constraints in
  // packages/database/migrations/002_customers_and_estimates.sql. The field form
  // reads them to constrain input as it is typed; the route reads them to reject
  // anything that reaches the API another way. One source, no drift.
  it('mirrors the migration 002 customers CHECK constraints', () => {
    expect(CUSTOMER_LIMITS.name).toMatchObject({ min: 2, max: 200, required: true });
    expect(CUSTOMER_LIMITS.phone).toMatchObject({ min: 0, max: 40, required: false });
    expect(CUSTOMER_LIMITS.email).toMatchObject({ min: 0, max: 320, required: false });
    expect(CUSTOMER_LIMITS.address).toMatchObject({ min: 0, max: 200, required: false });
    expect(CUSTOMER_LIMITS.town).toMatchObject({ min: 0, max: 100, required: false });
  });
});

describe('validateCustomerInput', () => {
  it('accepts a well-formed customer', () => {
    const r = validateCustomerInput(valid());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('Jane Smith');
  });

  it('rejects a non-object body', () => {
    expect(validateCustomerInput(null)).toMatchObject({ ok: false });
    expect(validateCustomerInput('nope')).toMatchObject({ ok: false });
  });

  it('rejects a missing or too-short name', () => {
    expect(validateCustomerInput({ ...valid(), name: '' })).toMatchObject({ ok: false, field: 'name' });
    expect(validateCustomerInput({ ...valid(), name: 'A' })).toMatchObject({ ok: false, field: 'name' });
  });

  it('rejects a name past the column limit', () => {
    expect(validateCustomerInput({ ...valid(), name: 'a'.repeat(201) }))
      .toMatchObject({ ok: false, field: 'name' });
  });

  it('rejects a phone that would violate the CHECK constraint', () => {
    // The bug this guards: '1'.repeat(41) passes a naive `typeof === string`
    // check, reaches Postgres, trips `char_length(phone) <= 40`, and surfaces as
    // a 503. The schema imposes no minimum, so short strings are legal.
    expect(validateCustomerInput({ ...valid(), phone: '1'.repeat(41) })).toMatchObject({ ok: false, field: 'phone' });
  });

  it('allows blank optional fields, which persist as NULL', () => {
    const r = validateCustomerInput({ name: 'Jane Smith', phone: '', email: '', address: '', town: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ phone: '', email: '', address: '', town: '' });
  });

  it('treats a whitespace-only optional field as blank, not as content', () => {
    // Untrimmed, '  ' is 2 chars and would slip past a length check on `town`
    // (min 0), then hit the DB as a meaningless value.
    const r = validateCustomerInput({ ...valid(), town: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.town).toBe('');
  });

  it('trims surrounding whitespace on accepted values', () => {
    const r = validateCustomerInput({ ...valid(), name: '  Jane Smith  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('Jane Smith');
  });

  it('rejects a name that is only whitespace', () => {
    expect(validateCustomerInput({ ...valid(), name: '     ' })).toMatchObject({ ok: false, field: 'name' });
  });

  it('rejects non-string fields instead of coercing them', () => {
    // `String({})` is '[object Object]' — 15 chars, which satisfies every length
    // check and persists silently. Type must be checked before length.
    expect(validateCustomerInput({ ...valid(), town: {} })).toMatchObject({ ok: false, field: 'town' });
    expect(validateCustomerInput({ ...valid(), phone: 6315550142 })).toMatchObject({ ok: false, field: 'phone' });
    expect(validateCustomerInput({ ...valid(), name: ['Jane'] })).toMatchObject({ ok: false, field: 'name' });
  });

  it('rejects a missing field rather than defaulting it', () => {
    const withoutTown: Record<string, unknown> = valid();
    delete withoutTown.town;
    expect(validateCustomerInput(withoutTown)).toMatchObject({ ok: false, field: 'town' });
  });

  it('names the offending field so the form can focus it', () => {
    const r = validateCustomerInput({ ...valid(), email: 'a'.repeat(321) });
    expect(r).toMatchObject({ ok: false, field: 'email' });
    if (!r.ok) expect(r.error).toMatch(/email/i);
  });
});
