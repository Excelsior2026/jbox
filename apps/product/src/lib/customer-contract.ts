// Deliberately NOT `server-only`: this module is the single place the customer
// field limits are written down. The field form imports CUSTOMER_LIMITS to
// constrain input as the technician types (maxLength, required), and the API
// route imports validateCustomerInput as the backstop for anything that reaches
// the customers API another way — a stale client, a retry, a direct call.
//
// These values mirror the CHECK constraints on `customers` in
// packages/database/migrations/002_customers_and_estimates.sql. Change them
// together.

export type CustomerFieldName = 'name' | 'phone' | 'email' | 'address' | 'town';

export type CustomerFieldLimit = {
  /** Minimum length once trimmed. Only enforced when the value is non-blank. */
  min: number;
  max: number;
  /** When false, a blank value is allowed and persists as SQL NULL. */
  required: boolean;
  /** Human label used in error messages and, later, form field labels. */
  label: string;
};

export const CUSTOMER_LIMITS: Record<CustomerFieldName, CustomerFieldLimit> = {
  // display_name: BETWEEN 2 AND 200
  name: { min: 2, max: 200, required: true, label: 'Name' },
  // phone: char_length <= 40 (no minimum in the schema; a blank persists as NULL)
  phone: { min: 0, max: 40, required: false, label: 'Phone' },
  // email: char_length <= 320
  email: { min: 0, max: 320, required: false, label: 'Email' },
  // service_address: char_length <= 200
  address: { min: 0, max: 200, required: false, label: 'Address' },
  // town: char_length <= 100
  town: { min: 0, max: 100, required: false, label: 'Town' },
};

export const CUSTOMER_FIELDS = Object.keys(CUSTOMER_LIMITS) as CustomerFieldName[];

export type CustomerInput = Record<CustomerFieldName, string>;

export type CustomerValidation =
  | { ok: true; value: CustomerInput }
  | { ok: false; error: string; field: CustomerFieldName | null };

export function validateCustomerInput(value: unknown): CustomerValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Body must be an object.', field: null };
  }
  const raw = value as Record<string, unknown>;
  const result = {} as CustomerInput;

  for (const field of CUSTOMER_FIELDS) {
    const limit = CUSTOMER_LIMITS[field];
    const supplied = raw[field];

    // Check the type before the length. `String({})` is '[object Object]' — 15
    // characters, which satisfies every limit here and would persist silently.
    if (typeof supplied !== 'string') {
      return { ok: false, error: `${limit.label} must be text.`, field };
    }

    // Trim first so whitespace can't stand in for content: '  ' is 2 characters
    // and would otherwise pass `town`'s min of 0... and then a length of 2 hits
    // no constraint, persisting a blank-looking value.
    const trimmed = supplied.trim();

    if (trimmed === '') {
      if (limit.required) return { ok: false, error: `${limit.label} is required.`, field };
      // Blank is the caller's way of saying "no value"; createCustomer maps it to NULL.
      result[field] = '';
      continue;
    }

    if (trimmed.length < limit.min || trimmed.length > limit.max) {
      return {
        ok: false,
        error: `${limit.label} must be between ${limit.min} and ${limit.max} characters.`,
        field,
      };
    }

    result[field] = trimmed;
  }

  return { ok: true, value: result };
}
