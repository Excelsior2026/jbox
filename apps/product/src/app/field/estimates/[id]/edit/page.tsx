import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getEstimate } from '@/lib/estimates';
import type { EstimateRecord } from '@/lib/estimate-record';
import type { EstimateDraftInput } from '@/lib/estimate-contract';
import { UUID_PATTERN } from '@/lib/ids';
import { EstimateEditor } from '../../estimate-editor';
import styles from '../../../field.module.css';

export const dynamic = 'force-dynamic';

type EditEstimateProps = {
  params: Promise<{ id: string }>;
};

function draftFromEstimate(estimate: EstimateRecord): EstimateDraftInput {
  return {
    customer: {
      name: estimate.customer.name,
      phone: estimate.customer.phone,
      email: estimate.customer.email,
      address: estimate.customer.address,
      town: estimate.customer.town,
      project: estimate.title,
    },
    scope: estimate.scope,
    exclusions: estimate.exclusions,
    notes: estimate.notes,
    discountMillipercent: estimate.discountMillipercent,
    surchargeCents: estimate.surchargeCents,
    taxRateMillipercent: estimate.taxRateMillipercent,
    depositCents: estimate.depositCents,
    lineItems: estimate.lineItems.map((line) => ({
      itemCode: line.itemCode,
      description: line.description,
      itemVersionId: line.itemVersionId,
      unitPriceCents: line.unitPriceCents,
      quantityHundredths: line.quantityHundredths,
      taxable: line.taxable,
    })),
  };
}

export default async function EditEstimate({ params }: EditEstimateProps) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return (
      <section className={styles.accessPanel}>
        <h1>No access to prepare estimates.</h1>
        <p>Your staff role does not include estimate preparation.</p>
      </section>
    );
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  if (!isDatabaseConfigured()) notFound();

  const estimate = await withFieldContext(principal, () => getEstimate(id));
  if (!estimate) notFound();

  if (estimate.status !== 'draft') {
    return (
      <>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>{estimate.displayId}</p>
            <h1 className={styles.pageTitle}>Cannot edit</h1>
            <p className={styles.subtitle}>
              This estimate is {estimate.status} and can no longer be edited.
            </p>
          </div>
          <div className={styles.actionBar}>
            <Link className={styles.buttonGhost} href={`/field/estimates/${estimate.id}`}>View estimate</Link>
          </div>
        </header>
        <div className={styles.alert} style={{ maxWidth: '640px' }}>
          Signed and declined estimates are terminal. Duplicate this estimate to
          revise it into a fresh draft.
        </div>
      </>
    );
  }

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{estimate.displayId} · Draft</p>
          <h1 className={styles.pageTitle}>Edit estimate</h1>
          <p className={styles.subtitle}>Changes record a new revision and are attributed to you.</p>
        </div>
        <Link className={styles.buttonGhost} href={`/field/estimates/${estimate.id}`}>Back to estimate</Link>
      </header>

      <EstimateEditor
        expectedUpdatedAt={estimate.updatedAt}
        estimateId={estimate.id}
        initialDraft={draftFromEstimate(estimate)}
        mode="edit"
      />
    </>
  );
}
