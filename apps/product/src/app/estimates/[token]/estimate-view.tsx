import type { CustomerEstimateDocument } from '@/lib/customer-estimate-document';
import type { EstimateRecord } from '@/lib/estimate-record';
import { EstimateDecisionForm } from './decision-form';
import styles from './estimate.module.css';

const STATUS_LABELS: Record<EstimateRecord['status'], string> = {
  draft: 'Draft',
  signed: 'Signed',
  declined: 'Declined',
};

function money(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function quantity(hundredths: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(hundredths / 100);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })
    .format(new Date(value));
}

export function EstimateView({
  token,
  document,
  intent,
  companyName,
  contact,
}: {
  token: string;
  document: CustomerEstimateDocument;
  intent: 'approve' | 'decline' | null;
  companyName: string | null;
  contact: { phone: string; email: string } | null;
}) {
  const { estimate, purpose, expiresAt } = document;
  const status = STATUS_LABELS[estimate.status];
  const totals = estimate.totals;
  const canDecide = purpose === 'sign' && estimate.status === 'draft';
  const alreadyDecided = purpose === 'sign' && estimate.status !== 'draft';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span>{companyName ?? 'Estimate'}</span>
          <strong>Estimate</strong>
        </div>
        <div className={styles.identity}>
          <span>{estimate.displayId}</span>
          <strong>{status}</strong>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Prepared for</p>
          <h1>{estimate.customer.name}</h1>
          <p>
            {estimate.customer.address}{estimate.customer.town && `, ${estimate.customer.town}`}
          </p>
        </div>
        <dl>
          <div><dt>Issued</dt><dd>{shortDate(estimate.createdAt)}</dd></div>
          <div><dt>Valid through</dt><dd>{shortDate(expiresAt)}</dd></div>
          <div><dt>Status</dt><dd>{status}</dd></div>
        </dl>
      </section>

      <section className={styles.content}>
        <div className={styles.mainColumn}>
          <article>
            <p className={styles.eyebrow}>Scope of work</p>
            <h2>{estimate.title}</h2>
            <p className={styles.scope}>{estimate.scope}</p>
            {estimate.exclusions && (
              <>
                <h3>Exclusions</h3>
                <p className={styles.scope}>{estimate.exclusions}</p>
              </>
            )}
            {estimate.notes && <p className={styles.notes}>{estimate.notes}</p>}
          </article>

          <article>
            <p className={styles.eyebrow}>Pricing</p>
            <div className={styles.lineItems}>
              {estimate.lineItems.map((line) => (
                <div className={styles.lineItem} key={line.id}>
                  <span>
                    <strong>{line.description}</strong>
                    {line.itemCode && <small>{line.itemCode}</small>}
                  </span>
                  <span>{quantity(line.quantityHundredths)}</span>
                  <span>{money(line.unitPriceCents)}</span>
                  <strong>{money(line.lineTotalCents)}</strong>
                </div>
              ))}
            </div>
          </article>
        </div>

        <aside className={styles.summary}>
          <p className={styles.eyebrow}>Estimate total</p>
          <dl>
            <div><dt>Subtotal</dt><dd>{money(totals.subtotalCents)}</dd></div>
            {totals.discountCents > 0 && (
              <div><dt>Discount</dt><dd>-{money(totals.discountCents)}</dd></div>
            )}
            {estimate.surchargeCents > 0 && (
              <div><dt>Surcharge</dt><dd>{money(estimate.surchargeCents)}</dd></div>
            )}
            <div><dt>Tax</dt><dd>{money(totals.taxCents)}</dd></div>
            <div className={styles.total}><dt>Total</dt><dd>{money(totals.totalCents)}</dd></div>
            {estimate.depositCents > 0 && (
              <div><dt>Deposit</dt><dd>{money(estimate.depositCents)}</dd></div>
            )}
          </dl>
          <p className={styles.expiry}>
            This private link expires {shortDate(expiresAt)}.
          </p>
        </aside>
      </section>

      {canDecide && (
        <EstimateDecisionForm
          token={token}
          intent={intent}
          companyName={companyName}
        />
      )}
      {alreadyDecided && (
        <p className={styles.decisionSuccess} role="status">
          This estimate has already been {status.toLowerCase()}.
        </p>
      )}

      <footer className={styles.footer}>
        {companyName && <span>{companyName}</span>}
        {contact?.phone && <span>{contact.phone}</span>}
        {contact?.email && <span>{contact.email}</span>}
      </footer>
    </main>
  );
}
