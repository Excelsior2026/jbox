'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  CUSTOMER_FIELDS,
  CUSTOMER_LIMITS,
  type CustomerFieldName,
  type CustomerInput,
} from '@/lib/customer-contract';
import type { CustomerRecord } from '@/lib/customers';
import styles from '../field.module.css';

type CustomerFormProps = {
  mode: 'create' | 'edit';
  initial?: CustomerRecord;
};

function initialValues(initial?: CustomerRecord): CustomerInput {
  return {
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    town: initial?.town ?? '',
  };
}

/**
 * Create / edit form for the customer directory. Posts to the Field API so the
 * same validation, rate limiting, and same-origin guards apply as any other
 * client. The edit mode carries expectedUpdatedAt so a concurrent change
 * surfaces as a clear conflict instead of silently overwriting.
 */
export function CustomerForm({ mode, initial }: CustomerFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<CustomerInput>(() => initialValues(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(field: CustomerFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const isEdit = mode === 'edit' && initial;
      const response = await fetch(
        isEdit ? `/api/field/customers/${initial!.id}` : '/api/field/customers',
        {
          method: isEdit ? 'PATCH' : 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isEdit
              ? { customer: values, expectedUpdatedAt: initial!.updatedAt }
              : values,
          ),
        },
      );
      const payload = await response.json() as {
        customer?: CustomerRecord;
        error?: string;
        reason?: string;
        retryable?: boolean;
      };

      if (!response.ok || !payload.customer) {
        if (response.status === 409 && payload.retryable) {
          throw new Error('This customer changed elsewhere. Reload and reapply your edits.');
        }
        throw new Error(payload.error || 'The customer could not be saved.');
      }

      if (isEdit) {
        setSaved(true);
        router.refresh();
      } else {
        router.push(`/field/customers/${payload.customer.id}`);
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The customer could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {CUSTOMER_FIELDS.map((field) => {
        const limit = CUSTOMER_LIMITS[field];
        return (
          <label className={styles.field} key={field}>
            {limit.label}
            <input
              autoComplete={field === 'name' ? 'name' : 'off'}
              maxLength={limit.max}
              minLength={limit.min}
              name={field}
              required={limit.required}
              value={values[field]}
              onChange={(event) => update(field, event.target.value)}
            />
          </label>
        );
      })}

      {error && <p className={styles.error} role="alert">{error}</p>}
      {saved && <p className={styles.ok} role="status">Saved.</p>}

      <div className={styles.formActions}>
        <button className={styles.button} disabled={busy} type="submit">
          {busy ? 'Saving…' : mode === 'create' ? 'Create customer' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
