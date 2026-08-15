import 'server-only';

import { DEFAULT_DOCUMENT_PREFIXES } from '@contractor-platform/configuration';
import type { Totals } from '@contractor-platform/money';
import { db } from '@/lib/db';
import { getEstimate } from '@/lib/estimates';
import { requireOrganizationContext } from '@/lib/organization-context-store';
import { loadInForceConfig } from '@/lib/tenant';
import type { InvoiceStatus } from '@/lib/invoice-contract';
import type { InvoiceRecord, InvoiceSummary } from '@/lib/invoice-record';
import { getJob, type JobEventContext } from '@/lib/jobs';

export type InvoiceEventContext = JobEventContext;

export type InvoiceLineRecord = {
  id: string;
  position: number;
  itemCode: string;
  description: string;
  itemVersionId: string | null;
  unitPriceCents: number;
  quantityHundredths: number;
  taxable: boolean;
  lineTotalCents: number;
};

export type InvoiceListFilter = {
  estimateId?: string;
  customerId?: string;
  jobId?: string;
  limit?: number;
};

export type CreateInvoiceFailure =
  | 'estimate-not-found'
  | 'estimate-not-signed'
  | 'job-required'
  | 'job-not-found'
  | 'job-terminal'
  | 'conflict';

export type CreateInvoiceResult =
  | { ok: true; value: InvoiceRecord | InvoiceSummary; reused: boolean }
  | { ok: false; reason: CreateInvoiceFailure };

type InvoiceRow = Record<string, unknown>;

const timestampToken = (row: InvoiceRow, column: 'created_at' | 'updated_at' | 'due_at') => {
  const exactToken = row[`${column}_token`];
  if (typeof exactToken === 'string') return exactToken;
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
};

const INVOICE_HEADER_SELECT = `
  invoice.*,
  customer.display_name AS customer_name,
  to_json(invoice.created_at) AS created_at_token,
  to_json(invoice.updated_at) AS updated_at_token,
  to_json(invoice.due_at) AS due_at_token
FROM invoices AS invoice
JOIN customers AS customer
  ON customer.id = invoice.customer_id
  AND customer.organization_id = invoice.organization_id
`;

function totalsFor(row: InvoiceRow): Totals {
  return {
    subtotalCents: Number(row.subtotal_cents),
    taxableSubtotalCents: Number(row.taxable_subtotal_cents),
    discountCents: Number(row.discount_cents),
    taxableAfterDiscountCents: Number(row.taxable_after_discount_cents),
    taxCents: Number(row.tax_cents),
    totalCents: Number(row.total_cents),
  };
}

function mapInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id as string,
    displayId: row.display_id as string,
    estimateId: (row.estimate_id as string) ?? null,
    jobId: (row.job_id as string) ?? null,
    customerId: row.customer_id as string,
    customerName: row.customer_name as string,
    status: row.status as InvoiceStatus,
    title: row.title as string,
    notes: (row.notes as string) ?? '',
    dueAt: row.due_at ? timestampToken(row, 'due_at') : null,
    discountMillipercent: row.discount_millipercent as number,
    surchargeCents: Number(row.surcharge_cents),
    taxRateMillipercent: row.tax_rate_millipercent as number,
    depositCents: Number(row.deposit_cents),
    totals: totalsFor(row),
    moneyVersion: row.money_version as number,
    contentHash: (row.content_hash as string) ?? null,
    createdAt: timestampToken(row, 'created_at'),
    updatedAt: timestampToken(row, 'updated_at'),
  };
}

function toSummary(row: InvoiceRow): InvoiceSummary {
  const invoice = mapInvoice(row);
  return {
    id: invoice.id,
    displayId: invoice.displayId,
    estimateId: invoice.estimateId,
    jobId: invoice.jobId,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    status: invoice.status,
    title: invoice.title,
    totals: invoice.totals,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

export async function listInvoices(filter: InvoiceListFilter = {}): Promise<InvoiceSummary[]> {
  const sql = db();
  const estimateId = filter.estimateId ?? null;
  const customerId = filter.customerId ?? null;
  const jobId = filter.jobId ?? null;
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
  const rows = (await sql.query(
    `SELECT ${INVOICE_HEADER_SELECT}
     WHERE ($1::uuid IS NULL OR invoice.estimate_id = $1::uuid)
       AND ($2::uuid IS NULL OR invoice.customer_id = $2::uuid)
       AND ($3::uuid IS NULL OR invoice.job_id = $3::uuid)
     ORDER BY invoice.created_at DESC, invoice.id
     LIMIT $4`,
    [estimateId, customerId, jobId, limit],
  )) as InvoiceRow[];
  return rows.map(toSummary);
}

export async function getInvoice(id: string): Promise<InvoiceRecord | null> {
  const sql = db();
  const rows = (await sql.query(
    `SELECT ${INVOICE_HEADER_SELECT} WHERE invoice.id = $1`,
    [id],
  )) as InvoiceRow[];
  if (!rows.length) return null;
  return mapInvoice(rows[0]);
}

export async function getInvoiceByEstimate(estimateId: string): Promise<InvoiceSummary | null> {
  const summaries = await listInvoices({ estimateId, limit: 1 });
  return summaries[0] ?? null;
}

export async function getInvoiceLines(invoiceId: string): Promise<InvoiceLineRecord[]> {
  const sql = db();
  const rows = (await sql.query(
    `SELECT
       line.id, line.position, line.item_code, line.description, line.item_version_id,
       line.unit_price_cents, line.quantity_hundredths, line.taxable, line.line_total_cents
     FROM invoice_line_items AS line
     WHERE line.invoice_id = $1
     ORDER BY line.position, line.id`,
    [invoiceId],
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    position: r.position as number,
    itemCode: r.item_code as string,
    description: r.description as string,
    itemVersionId: (r.item_version_id as string) ?? null,
    unitPriceCents: Number(r.unit_price_cents),
    quantityHundredths: Number(r.quantity_hundredths),
    taxable: r.taxable as boolean,
    lineTotalCents: Number(r.line_total_cents),
  }));
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null
  && (error as { code?: string }).code === '23505';

/**
 * Freezes a signed estimate into a jbox invoice: one invoice per estimate
 * (invoices_estimate_id_uniq), a faithful copy of the header, lines, and
 * persisted totals, and both audit histories recording the freeze. The estimate
 * row itself is never touched, so an existing editor's expectedUpdatedAt
 * remains valid after the invoice is created.
 */
export async function createInvoiceFromEstimate(
  estimateId: string,
  expectedUpdatedAt: string,
  ctx: InvoiceEventContext,
): Promise<CreateInvoiceResult> {
  const existing = await getInvoiceByEstimate(estimateId);
  if (existing) return { ok: true, value: existing, reused: true };

  const estimate = await getEstimate(estimateId);
  if (!estimate) return { ok: false, reason: 'estimate-not-found' };
  if (estimate.status !== 'signed') return { ok: false, reason: 'estimate-not-signed' };
  if (!estimate.jobId) return { ok: false, reason: 'job-required' };
  if (estimate.updatedAt !== expectedUpdatedAt) return { ok: false, reason: 'conflict' };

  const jobId = estimate.jobId;
  const job = await getJob(jobId);
  if (!job) return { ok: false, reason: 'job-not-found' };
  if (job.status === 'cancelled') return { ok: false, reason: 'job-terminal' };

  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const config = await loadInForceConfig();
  const prefix = config?.documents.prefixes.invoice ?? DEFAULT_DOCUMENT_PREFIXES.invoice;

  // target re-checks every classification inside the statement; the partial
  // unique index from migration 012 is the arbiter for races.
  let inserted: InvoiceRow[];
  try {
    inserted = (await sql`
      WITH allocated AS (
        SELECT allocate_document_number('invoice') AS n
      ),
      target AS (
        SELECT
          estimate.id, estimate.customer_id, job.id AS job_id,
          estimate.title, estimate.notes,
          estimate.discount_millipercent, estimate.surcharge_cents,
          estimate.tax_rate_millipercent, estimate.deposit_cents,
          estimate.money_version,
          estimate.subtotal_cents, estimate.taxable_subtotal_cents,
          estimate.discount_cents, estimate.taxable_after_discount_cents,
          estimate.tax_cents, estimate.total_cents
        FROM estimates AS estimate
        JOIN jobs AS job ON job.estimate_id = estimate.id
        WHERE estimate.id = ${estimateId}::uuid
          AND estimate.status = 'signed'
          AND estimate.updated_at = ${expectedUpdatedAt}::timestamptz
          AND job.status <> 'cancelled'
          AND NOT EXISTS (
            SELECT 1 FROM invoices
            WHERE estimate_id = estimate.id
              AND organization_id = app_require_organization_id()
          )
      ),
      inserted AS (
        INSERT INTO invoices
          (organization_id, document_number, display_id, customer_id, job_id, estimate_id,
           status, title, notes,
           discount_millipercent, surcharge_cents, tax_rate_millipercent, deposit_cents,
           subtotal_cents, taxable_subtotal_cents, discount_cents,
           taxable_after_discount_cents, tax_cents, total_cents, money_version)
        SELECT app_require_organization_id(), allocated.n,
               ${`${prefix}-`} || lpad(allocated.n::text, 4, '0'),
               target.customer_id, target.job_id, target.id,
               'draft', target.title, target.notes,
               target.discount_millipercent, target.surcharge_cents,
               target.tax_rate_millipercent, target.deposit_cents,
               target.subtotal_cents, target.taxable_subtotal_cents, target.discount_cents,
               target.taxable_after_discount_cents, target.tax_cents, target.total_cents,
               target.money_version
        FROM allocated CROSS JOIN target
        RETURNING id, estimate_id
      ),
      inserted_lines AS (
        INSERT INTO invoice_line_items
          (organization_id, invoice_id, position, item_code, description, item_version_id,
           quantity_hundredths, unit_price_cents, taxable, line_total_cents)
        SELECT app_require_organization_id(), inserted.id, line.position, line.item_code,
               line.description, line.item_version_id,
               line.quantity_hundredths, line.unit_price_cents, line.taxable,
               line.line_total_cents
        FROM inserted
        JOIN estimate_line_items AS line ON line.estimate_id = inserted.estimate_id
        ORDER BY line.position
      ),
      invoice_logged AS (
        INSERT INTO invoice_events (organization_id, invoice_id, event, actor_id, meta)
        SELECT app_require_organization_id(), id, 'created', ${actorId},
               jsonb_build_object('estimate_id', ${estimateId}::text,
                                  'job_id', ${jobId}::text,
                                  'request_ip', ${ctx.ip}::text,
                                  'user_agent', ${ctx.userAgent}::text)
        FROM inserted
        RETURNING invoice_id
      ),
      estimate_logged AS (
        INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
        SELECT app_require_organization_id(), ${estimateId}, 'invoice_created', ${actorId},
               jsonb_build_object('invoice_id', id::text,
                                  'request_ip', ${ctx.ip}::text,
                                  'user_agent', ${ctx.userAgent}::text)
        FROM inserted
        RETURNING estimate_id
      )
      SELECT id FROM inserted
    `) as InvoiceRow[];
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await getInvoiceByEstimate(estimateId);
      if (raced) return { ok: true, value: raced, reused: true };
    }
    throw error;
  }

  if (inserted.length) {
    const created = await getInvoice(inserted[0].id as string);
    if (!created) throw new Error('Created invoice could not be read.');
    return { ok: true, value: created, reused: false };
  }

  const raced = await getInvoiceByEstimate(estimateId);
  if (raced) return { ok: true, value: raced, reused: true };
  return { ok: false, reason: 'conflict' };
}
