'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  computeTotals,
} from '@contractor-platform/money';
import { CUSTOMER_LIMITS } from '@/lib/customer-contract';
import type { CustomerRecord } from '@/lib/customers';
import type {
  EstimateDraftInput,
  EstimateLineInput,
} from '@/lib/estimate-contract';
import type { EstimateRecord } from '@/lib/estimate-record';
import { money, percent } from '../format';
import styles from '../field.module.css';

type LineRow = {
  key: number;
  itemCode: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
};

type EstimateEditorProps = {
  mode: 'create' | 'edit';
  estimateId?: string;
  expectedUpdatedAt?: string;
  /** Create with an existing directory customer. */
  customerId?: string;
  customer?: CustomerRecord;
  /** Edit prefill (an existing draft). */
  initialDraft?: EstimateDraftInput;
};

function centsToDollars(cents: number) {
  return String(cents / 100);
}

function hundredthsToQuantity(hundredths: number) {
  return String(hundredths / 100);
}

function milliToPercent(millipercent: number) {
  return String(millipercent / 1000);
}

function parseCents(text: string): number {
  return Math.round(parseFloat(text) * 100);
}

function parseHundredths(text: string): number {
  return Math.round(parseFloat(text) * 100);
}

function parseMilli(text: string): number {
  return Math.round(parseFloat(text) * 1000);
}

function isNonNegativeNumber(text: string): boolean {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && value >= 0;
}

let nextLineKey = 1;

/**
 * The estimate editor. Drafts are plain JSON to the Field API, so this form
 * owns the whole input contract from customer + project through scope, notes,
 * line items, and the four pricing adjustments — and mirrors the money math
 * (`computeTotals`) so the technician sees the same total the API will record.
 * Create mode either addresses an existing directory customer (customerId) or
 * carries a new one (newCustomer); edit mode patches the draft with
 * expectedUpdatedAt for optimistic-concurrency.
 */
export function EstimateEditor({
  mode,
  estimateId,
  expectedUpdatedAt,
  customerId,
  customer,
  initialDraft,
}: EstimateEditorProps) {
  const router = useRouter();
  const customerLocked = mode === 'edit' || Boolean(customerId);

  const draft = initialDraft;
  const [customerState, setCustomerState] = useState({
    name: draft?.customer.name ?? customer?.name ?? '',
    phone: draft?.customer.phone ?? customer?.phone ?? '',
    email: draft?.customer.email ?? customer?.email ?? '',
    address: draft?.customer.address ?? customer?.address ?? '',
    town: draft?.customer.town ?? customer?.town ?? '',
    project: draft?.customer.project ?? '',
  });
  const [scope, setScope] = useState(draft?.scope ?? '');
  const [exclusions, setExclusions] = useState(draft?.exclusions ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [discountPercent, setDiscountPercent] = useState(
    draft ? milliToPercent(draft.discountMillipercent) : '',
  );
  const [taxPercent, setTaxPercent] = useState(
    draft ? milliToPercent(draft.taxRateMillipercent) : '',
  );
  const [surcharge, setSurcharge] = useState(
    draft ? centsToDollars(draft.surchargeCents) : '',
  );
  const [deposit, setDeposit] = useState(
    draft ? centsToDollars(draft.depositCents) : '',
  );
  const [lineItems, setLineItems] = useState<LineRow[]>(() =>
    draft
      ? draft.lineItems.map((line) => ({
          key: nextLineKey++,
          itemCode: line.itemCode,
          description: line.description,
          quantity: hundredthsToQuantity(line.quantityHundredths),
          unitPrice: centsToDollars(line.unitPriceCents),
          taxable: line.taxable,
        }))
      : [{ key: nextLineKey++, itemCode: '', description: '', quantity: '1', unitPrice: '', taxable: true }],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneMissing = customerLocked && customerState.phone.trim() === '';

  const discountMillipercent = discountPercent.trim() === ''
    ? 0
    : parseMilli(discountPercent);
  const surchargeCents = surcharge.trim() === '' ? 0 : parseCents(surcharge);
  const taxRateMillipercent = taxPercent.trim() === '' ? 0 : parseMilli(taxPercent);
  const depositCents = deposit.trim() === '' ? 0 : parseCents(deposit);

  const totals = computeTotals(
    lineItems.map((line) => ({
      unitPriceCents: line.unitPrice.trim() === '' ? 0 : parseCents(line.unitPrice),
      quantityHundredths: line.quantity.trim() === '' ? 0 : parseHundredths(line.quantity),
      taxable: line.taxable,
    })),
    {
      discountMillipercent,
      surchargeCents,
      taxRateMillipercent,
    },
  );

  function updateCustomer(field: keyof typeof customerState, value: string) {
    setCustomerState((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function updateLine(key: number, patch: Partial<LineRow>) {
    setLineItems((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
    setError(null);
  }

  function removeLine(key: number) {
    setLineItems((current) => current.filter((line) => line.key !== key));
  }

  function addLine() {
    setLineItems((current) => [
      ...current,
      { key: nextLineKey++, itemCode: '', description: '', quantity: '1', unitPrice: '', taxable: true },
    ]);
  }

  function validate(): string | null {
    if (customerState.name.trim().length < CUSTOMER_LIMITS.name.min) {
      return 'Customer name is required.';
    }
    if (customerState.phone.trim() === '') return 'Customer phone is required.';
    if (customerState.project.trim().length < 2) {
      return 'Project is required (at least 2 characters).';
    }
    if (customerState.project.length > 200) return 'Project is too long.';
    if (customerState.email.length > CUSTOMER_LIMITS.email.max) return 'Customer email is too long.';
    if (customerState.address.length > CUSTOMER_LIMITS.address.max) return 'Customer address is too long.';
    if (customerState.town.length > CUSTOMER_LIMITS.town.max) return 'Customer town is too long.';
    if (scope.length > 4000 || exclusions.length > 4000 || notes.length > 4000) {
      return 'Scope, exclusions, and notes are limited to 4000 characters.';
    }
    if (discountPercent.trim() !== '' && !isNonNegativeNumber(discountPercent)) {
      return 'Discount must be a non-negative number.';
    }
    if (discountMillipercent > 100000) return 'Discount cannot exceed 100%.';
    if (surcharge.trim() !== '' && !isNonNegativeNumber(surcharge)) return 'Surcharge must be a non-negative number.';
    if (taxPercent.trim() !== '' && !isNonNegativeNumber(taxPercent)) return 'Tax rate must be a non-negative number.';
    if (deposit.trim() !== '' && !isNonNegativeNumber(deposit)) return 'Deposit must be a non-negative number.';
    if (lineItems.length === 0) return 'Add at least one line item.';
    for (const line of lineItems) {
      if (line.description.trim() === '') return 'Every line item needs a description.';
      if (line.itemCode.length > 40) return 'Item codes are limited to 40 characters.';
      if (line.quantity.trim() !== '' && !isNonNegativeNumber(line.quantity)) return 'Quantities must be non-negative.';
      if (line.unitPrice.trim() !== '' && !isNonNegativeNumber(line.unitPrice)) return 'Unit prices must be non-negative.';
    }
    return null;
  }

  function buildDraft(): EstimateDraftInput {
    const lineItemsInput: EstimateLineInput[] = lineItems.map((line) => ({
      itemCode: line.itemCode.trim(),
      description: line.description.trim(),
      itemVersionId: null,
      unitPriceCents: line.unitPrice.trim() === '' ? 0 : parseCents(line.unitPrice),
      quantityHundredths: line.quantity.trim() === '' ? 0 : parseHundredths(line.quantity),
      taxable: line.taxable,
    }));

    return {
      customer: {
        name: customerState.name.trim(),
        phone: customerState.phone.trim(),
        email: customerState.email.trim(),
        address: customerState.address.trim(),
        town: customerState.town.trim(),
        project: customerState.project.trim(),
      },
      scope,
      exclusions,
      notes,
      discountMillipercent,
      surchargeCents,
      taxRateMillipercent,
      depositCents,
      lineItems: lineItemsInput,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (phoneMissing) {
      setError('This customer has no phone on file. Add one in the customer directory before saving.');
      return;
    }
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const draftValue = buildDraft();
      const isEdit = mode === 'edit' && estimateId;

      const body = isEdit
        ? { expectedUpdatedAt, draft: draftValue }
        : customerId
          ? { customerId, draft: draftValue }
          : {
              newCustomer: {
                name: draftValue.customer.name,
                phone: draftValue.customer.phone,
                email: draftValue.customer.email,
                address: draftValue.customer.address,
                town: draftValue.customer.town,
              },
              draft: draftValue,
            };

      const response = await fetch(
        isEdit ? `/api/field/estimates/${encodeURIComponent(estimateId)}` : '/api/field/estimates',
        {
          method: isEdit ? 'PATCH' : 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json() as {
        estimate?: EstimateRecord;
        error?: string;
        reason?: string;
        retryable?: boolean;
      };

      if (!response.ok || !payload.estimate) {
        if (response.status === 409) {
          if (payload.retryable) {
            throw new Error('This estimate changed since you loaded it. Reload and reapply your edits.');
          }
          throw new Error('This estimate is signed or declined and can no longer be edited. Duplicate it to revise.');
        }
        throw new Error(payload.error || 'The estimate could not be saved.');
      }

      router.push(`/field/estimates/${payload.estimate.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The estimate could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const inputProps = (lock: boolean) => ({
    disabled: lock,
    className: lock ? `${styles.lineInput} ${styles.readOnly}` : styles.lineInput,
  });
  const contactInput = (field: 'name' | 'phone' | 'email' | 'address' | 'town') => ({
    ...inputProps(customerLocked),
    maxLength: CUSTOMER_LIMITS[field].max,
    required: !customerLocked && CUSTOMER_LIMITS[field].required,
  });

  return (
    <form className={styles.editor} onSubmit={submit}>
      <section className={styles.editorSection}>
        <h2>Customer &amp; project</h2>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            Name
            <input
              value={customerState.name}
              onChange={(e) => updateCustomer('name', e.target.value)}
              {...contactInput('name')}
            />
          </label>
          <label className={styles.field}>
            Phone
            <input
              value={customerState.phone}
              onChange={(e) => updateCustomer('phone', e.target.value)}
              {...contactInput('phone')}
            />
          </label>
          <label className={styles.field}>
            Email
            <input
              type="email"
              value={customerState.email}
              onChange={(e) => updateCustomer('email', e.target.value)}
              {...contactInput('email')}
            />
          </label>
          <label className={styles.field}>
            Address
            <input
              value={customerState.address}
              onChange={(e) => updateCustomer('address', e.target.value)}
              {...contactInput('address')}
            />
          </label>
          <label className={styles.field}>
            Town
            <input
              value={customerState.town}
              onChange={(e) => updateCustomer('town', e.target.value)}
              {...contactInput('town')}
            />
          </label>
          <label className={styles.field}>
            Project
            <input
              maxLength={200}
              minLength={2}
              required
              value={customerState.project}
              onChange={(e) => updateCustomer('project', e.target.value)}
            />
            <span className={styles.hint}>
              {customerLocked
                ? 'Contact details are managed in the customer directory.'
                : 'A new customer directory entry is created with this estimate.'}
            </span>
          </label>
        </div>
      </section>

      <section className={styles.editorSection}>
        <h2>Scope</h2>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            Scope of work
            <textarea
              maxLength={4000}
              rows={4}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Exclusions
            <textarea
              maxLength={4000}
              rows={4}
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Notes
            <textarea
              maxLength={4000}
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className={styles.editorSection}>
        <h2>Line items</h2>
        <div className={styles.lineItems}>
          {lineItems.map((line) => (
            <div className={styles.lineItem} key={line.key}>
              <input
                className={styles.lineInput}
                maxLength={40}
                placeholder="Item code"
                value={line.itemCode}
                onChange={(e) => updateLine(line.key, { itemCode: e.target.value })}
              />
              <input
                className={styles.lineInput}
                maxLength={500}
                placeholder="Description"
                required
                value={line.description}
                onChange={(e) => updateLine(line.key, { description: e.target.value })}
              />
              <input
                className={styles.lineInput}
                inputMode="decimal"
                placeholder="Qty"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
              />
              <input
                className={styles.lineInput}
                inputMode="decimal"
                placeholder="Unit price"
                value={line.unitPrice}
                onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
              />
              <label className={styles.lineCheck}>
                <input
                  checked={line.taxable}
                  type="checkbox"
                  onChange={(e) => updateLine(line.key, { taxable: e.target.checked })}
                />
                Tax
              </label>
              <button
                aria-label="Remove line item"
                className={styles.removeLine}
                disabled={lineItems.length === 1}
                type="button"
                onClick={() => removeLine(line.key)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button className={`${styles.buttonGhost} ${styles.buttonSmall} ${styles.addLine}`} type="button" onClick={addLine}>
          Add line item
        </button>
      </section>

      <section className={styles.editorSection}>
        <h2>Pricing</h2>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            Discount %
            <input
              inputMode="decimal"
              maxLength={8}
              placeholder="0"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Tax rate %
            <input
              inputMode="decimal"
              maxLength={8}
              placeholder="0"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Surcharge ($)
            <input
              inputMode="decimal"
              maxLength={12}
              placeholder="0.00"
              value={surcharge}
              onChange={(e) => setSurcharge(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Deposit ($)
            <input
              inputMode="decimal"
              maxLength={12}
              placeholder="0.00"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.totals}>
          <div className={styles.totalsRow}><span>Subtotal</span><span>{money(totals.subtotalCents)}</span></div>
          {totals.discountCents > 0 && (
            <div className={styles.totalsRow}><span>Discount ({percent(discountMillipercent)})</span><span>-{money(totals.discountCents)}</span></div>
          )}
          {surchargeCents > 0 && (
            <div className={styles.totalsRow}><span>Surcharge</span><span>{money(surchargeCents)}</span></div>
          )}
          <div className={styles.totalsRow}><span>Tax ({percent(taxRateMillipercent)})</span><span>{money(totals.taxCents)}</span></div>
          <div className={`${styles.totalsRow} ${styles.totalsRowTotal}`}><span>Total</span><span>{money(totals.totalCents)}</span></div>
          {depositCents > 0 && (
            <div className={styles.totalsRow}><span>Deposit</span><span>{money(depositCents)}</span></div>
          )}
        </div>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.formActions}>
        <button className={styles.button} disabled={busy || phoneMissing} type="submit">
          {busy ? 'Saving…' : mode === 'create' ? 'Create estimate' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
