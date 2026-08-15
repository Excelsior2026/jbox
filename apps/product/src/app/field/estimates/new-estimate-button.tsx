'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  CUSTOMER_LIMITS,
  validateCustomerInput,
  type CustomerInput,
} from '@/lib/customer-contract';
import type { CustomerRecord } from '@/lib/customers';
import styles from '../field.module.css';

type ApiError = {
  error?: string;
};

const emptyCustomer: CustomerInput = {
  name: '',
  phone: '',
  email: '',
  address: '',
  town: '',
};

async function responsePayload<T>(response: Response): Promise<T & ApiError> {
  try {
    return await response.json() as T & ApiError;
  } catch {
    return {} as T & ApiError;
  }
}

export default function NewEstimateButton({
  label = 'New estimate',
  variant = 'primary',
}: {
  label?: string;
  variant?: 'primary' | 'ghost' | 'plain';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerMode, setCustomerMode] = useState<'search' | 'create'>('search');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerRecord[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [customerForm, setCustomerForm] = useState<CustomerInput>(emptyCustomer);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  function closeModal() {
    if (creating) return;
    setOpen(false);
    setFormError('');
    setCustomerResults([]);
    setCustomerSearch('');
    setCustomerForm(emptyCustomer);
    setCustomerMode('search');
  }

  function startEstimate(customerId: string) {
    router.push(`/field/estimates/new?customerId=${encodeURIComponent(customerId)}`);
  }

  async function searchForCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = customerSearch.trim();
    if (!query) {
      setCustomerResults([]);
      setFormError('Enter a customer name, phone, or email.');
      return;
    }

    setCustomerSearching(true);
    setFormError('');
    try {
      const params = new URLSearchParams({ q: query });
      const response = await fetch(`/api/field/customers?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = await responsePayload<{ customers?: CustomerRecord[] }>(response);
      if (!response.ok || !Array.isArray(payload.customers)) {
        throw new Error(payload.error || 'Customer search failed.');
      }
      setCustomerResults(payload.customers);
    } catch (error) {
      setCustomerResults([]);
      setFormError(error instanceof Error ? error.message : 'Customer search failed.');
    } finally {
      setCustomerSearching(false);
    }
  }

  async function createCustomerAndEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateCustomerInput(customerForm);
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    setCreating(true);
    setFormError('');
    try {
      const response = await fetch('/api/field/customers', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validation.value),
      });
      const payload = await responsePayload<{ customer?: CustomerRecord }>(response);
      if (!response.ok || !payload.customer) {
        throw new Error(payload.error || 'The customer could not be created.');
      }
      startEstimate(payload.customer.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The customer could not be created.');
      setCreating(false);
    }
  }

  const buttonClass = variant === 'primary'
    ? styles.button
    : variant === 'ghost'
      ? styles.buttonGhost
      : styles.estimateListEmptyButton;

  return (
    <>
      <button className={buttonClass} type="button" onClick={() => setOpen(true)}>
        {label}
      </button>

      {open && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className={`${styles.smallModal} ${styles.newEstimateModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-estimate-title"
          >
            <div className={styles.modalHeader}>
              <div><span>Standalone estimate</span><h2 id="new-estimate-title">Choose a customer</h2></div>
              <button type="button" onClick={closeModal} aria-label="Close">×</button>
            </div>

            <div className={styles.customerModeTabs} role="tablist" aria-label="Customer options">
              <button
                className={customerMode === 'search' ? styles.customerModeActive : ''}
                type="button"
                role="tab"
                aria-selected={customerMode === 'search'}
                onClick={() => {
                  setCustomerMode('search');
                  setFormError('');
                }}
              >
                Search existing
              </button>
              <button
                className={customerMode === 'create' ? styles.customerModeActive : ''}
                type="button"
                role="tab"
                aria-selected={customerMode === 'create'}
                onClick={() => {
                  setCustomerMode('create');
                  setFormError('');
                }}
              >
                Add new
              </button>
            </div>

            {customerMode === 'search' ? (
              <>
                <form className={styles.customerSearchForm} onSubmit={searchForCustomer}>
                  <label htmlFor="estimate-customer-search">Name, phone, or email</label>
                  <div>
                    <input
                      id="estimate-customer-search"
                      autoFocus
                      value={customerSearch}
                      maxLength={80}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                    />
                    <button type="submit" disabled={customerSearching}>
                      {customerSearching ? 'Searching…' : 'Search'}
                    </button>
                  </div>
                </form>
                <div className={styles.customerResults} aria-live="polite">
                  {customerResults.map((customer) => (
                    <div className={styles.customerResult} key={customer.id}>
                      <div>
                        <strong>{customer.name}</strong>
                        <span>{customer.phone || 'No phone'} · {customer.email || 'No email'}</span>
                        <small>{customer.address || 'No address'}{customer.town ? ` · ${customer.town}` : ''}</small>
                      </div>
                      <Link href={`/field/estimates/new?customerId=${encodeURIComponent(customer.id)}`}>
                        Start estimate
                      </Link>
                    </div>
                  ))}
                  {!customerSearching && customerSearch.trim() && customerResults.length === 0 && (
                    <p>No matching customers. Choose “Add new” to create one.</p>
                  )}
                </div>
              </>
            ) : (
              <form className={styles.newCustomerForm} onSubmit={createCustomerAndEstimate}>
                <div className={styles.newCustomerFields}>
                  <label>
                    Name
                    <input
                      required
                      autoFocus
                      minLength={CUSTOMER_LIMITS.name.min}
                      maxLength={CUSTOMER_LIMITS.name.max}
                      value={customerForm.name}
                      onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      maxLength={CUSTOMER_LIMITS.phone.max}
                      inputMode="tel"
                      value={customerForm.phone}
                      onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))}
                    />
                  </label>
                  <label>
                    Email <span>Optional</span>
                    <input
                      type="email"
                      maxLength={CUSTOMER_LIMITS.email.max}
                      value={customerForm.email}
                      onChange={(event) => setCustomerForm((current) => ({ ...current, email: event.target.value }))}
                    />
                  </label>
                  <label>
                    Address <span>Optional</span>
                    <input
                      maxLength={CUSTOMER_LIMITS.address.max}
                      value={customerForm.address}
                      onChange={(event) => setCustomerForm((current) => ({ ...current, address: event.target.value }))}
                    />
                  </label>
                  <label>
                    Town <span>Optional</span>
                    <input
                      maxLength={CUSTOMER_LIMITS.town.max}
                      value={customerForm.town}
                      onChange={(event) => setCustomerForm((current) => ({ ...current, town: event.target.value }))}
                    />
                  </label>
                </div>
                <button className={styles.primaryAction} type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create customer and estimate'}
                </button>
              </form>
            )}

            {formError && <p className={styles.estimateFormError} role="alert">{formError}</p>}
          </section>
        </div>
      )}
    </>
  );
}
