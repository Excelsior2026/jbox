import 'server-only';
import { DEFAULT_DOCUMENT_PREFIXES } from '@contractor-platform/configuration';
import { computeTotals, CURRENT_MONEY_VERSION, divRoundHalfUp, type Totals } from '@contractor-platform/money';
import { contentHash } from '@/lib/estimate-document';
import { canTransition, type EstimateDraftInput, type EstimateStatus } from '@/lib/estimate-contract';
import { requireOrganizationContext } from '@/lib/organization-context-store';
import { db } from '@/lib/db';
import { loadInForceConfig } from '@/lib/tenant';
import type { EstimateLineRecord, EstimateRecord, EstimateSummary } from '@/lib/estimate-record';

export type { EstimateLineRecord, EstimateRecord, EstimateSummary } from '@/lib/estimate-record';

export type EstimateEventContext = { ip: string | null; userAgent: string | null };

export type CreateEstimateContext = {
  customerId: string;
  serviceRequestId: string | null;
} & EstimateEventContext;

export type EstimateListFilter = {
  status?: EstimateStatus;
  customerId?: string;
  serviceRequestId?: string;
};

type HeaderRow = Record<string, unknown>;
type LineRow = Record<string, unknown>;

const timestampToken = (row: HeaderRow, column: 'created_at' | 'updated_at' | 'signed_at' | 'declined_at') => {
  const exactToken = row[`${column}_token`];
  if (typeof exactToken === 'string') return exactToken;
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
};

function mapLine(r: LineRow): EstimateLineRecord {
  return {
    id: r.id as string,
    position: r.position as number,
    itemCode: r.item_code as string,
    description: r.description as string,
    itemVersionId: (r.item_version_id as string) ?? null,
    unitPriceCents: Number(r.unit_price_cents),
    quantityHundredths: Number(r.quantity_hundredths),
    taxable: r.taxable as boolean,
    lineTotalCents: Number(r.line_total_cents),
    areaId: (r.area_id as string) ?? null,
    priceOrigin: (r.price_origin as EstimateLineRecord['priceOrigin']) ?? 'unverified',
    catalogItemId: (r.catalog_item_id as string) ?? null,
    releaseId: (r.release_id as string) ?? null,
  };
}

function mapAreas(header: HeaderRow): EstimateRecord['areas'] {
  const raw = header.areas;
  if (!Array.isArray(raw)) return [];
  return raw as EstimateRecord['areas'];
}

function totalsFor(header: HeaderRow): Totals {
  return {
    subtotalCents: Number(header.subtotal_cents),
    taxableSubtotalCents: Number(header.taxable_subtotal_cents),
    discountCents: Number(header.discount_cents),
    taxableAfterDiscountCents: Number(header.taxable_after_discount_cents),
    taxCents: Number(header.tax_cents),
    totalCents: Number(header.total_cents),
  };
}

function mapCustomer(header: HeaderRow): EstimateRecord['customer'] {
  // A signed estimate renders the frozen snapshot it was accepted under; a draft
  // renders the live directory row.
  const signed = header.status === 'signed';
  return {
    name: (signed ? header.customer_name : header.customer_display_name) as string,
    phone: (signed ? header.customer_phone : header.customer_phone_live) as string,
    email: (signed ? header.customer_email : header.customer_email_live) as string,
    address: (signed ? header.customer_address : header.customer_address_live) as string,
    town: (signed ? header.customer_town : header.customer_town_live) as string,
    project: header.title as string,
  };
}

const HEADER_SELECT = `
  e.*,
  to_json(e.created_at) AS created_at_token,
  to_json(e.updated_at) AS updated_at_token,
  to_json(e.signed_at) AS signed_at_token,
  to_json(e.declined_at) AS declined_at_token,
  (SELECT job.id FROM jobs job
    WHERE job.estimate_id = e.id AND job.organization_id = e.organization_id
    ORDER BY job.created_at, job.id LIMIT 1) AS job_id,
  (SELECT invoice.id FROM invoices invoice
    WHERE invoice.estimate_id = e.id AND invoice.organization_id = e.organization_id
    ORDER BY invoice.created_at, invoice.id LIMIT 1) AS invoice_id,
  c.display_name AS customer_display_name,
  c.phone AS customer_phone_live,
  c.email AS customer_email_live,
  c.service_address AS customer_address_live,
  c.town AS customer_town_live
FROM estimates e
JOIN customers c ON c.id = e.customer_id AND c.organization_id = e.organization_id
`;

function mapEstimate(header: HeaderRow, lines: LineRow[]): EstimateRecord {
  return {
    id: header.id as string,
    displayId: header.display_id as string,
    customerId: header.customer_id as string,
    serviceRequestId: (header.service_request_id as string) ?? null,
    jobId: (header.job_id as string) ?? null,
    invoiceId: (header.invoice_id as string) ?? null,
    status: header.status as EstimateStatus,
    title: header.title as string,
    notes: (header.notes as string) ?? '',
    scope: (header.scope as string) ?? '',
    exclusions: (header.exclusions as string) ?? '',
    discountMillipercent: header.discount_millipercent as number,
    surchargeCents: Number(header.surcharge_cents),
    taxRateMillipercent: header.tax_rate_millipercent as number,
    depositCents: Number(header.deposit_cents),
    totals: totalsFor(header),
    moneyVersion: header.money_version as number,
    documentTemplateVersion: header.document_template_version as string,
    customer: mapCustomer(header),
    areas: mapAreas(header),
    lineItems: lines.map(mapLine),
    signedByName: (header.signed_by_name as string) ?? null,
    signedAt: header.signed_at ? timestampToken(header, 'signed_at') : null,
    signatureContext: (header.signature_context as string) ?? null,
    signatureImage: (header.signature_image as string) ?? null,
    declinedAt: header.declined_at ? timestampToken(header, 'declined_at') : null,
    contentHash: (header.content_hash as string) ?? null,
    createdAt: timestampToken(header, 'created_at'),
    updatedAt: timestampToken(header, 'updated_at'),
  };
}

function toSummary(header: HeaderRow): EstimateSummary {
  return {
    id: header.id as string,
    displayId: header.display_id as string,
    customerId: header.customer_id as string,
    status: header.status as EstimateStatus,
    customerName: header.status === 'signed'
      ? (header.customer_name as string)
      : (header.customer_display_name as string),
    title: header.title as string,
    town: header.status === 'signed'
      ? (header.customer_town as string)
      : (header.customer_town_live as string),
    totals: totalsFor(header),
    createdAt: timestampToken(header, 'created_at'),
    updatedAt: timestampToken(header, 'updated_at'),
  };
}

async function estimatePrefix(): Promise<string> {
  const config = await loadInForceConfig();
  return config?.documents.prefixes.estimate ?? DEFAULT_DOCUMENT_PREFIXES.estimate;
}

export async function getEstimate(id: string): Promise<EstimateRecord | null> {
  const sql = db();
  const headers = (await sql.query(`SELECT ${HEADER_SELECT} WHERE e.id = $1`, [id])) as HeaderRow[];
  if (!headers.length) return null;
  const lines = (await sql.query(
    'SELECT * FROM estimate_line_items WHERE estimate_id = $1 ORDER BY position',
    [id],
  )) as LineRow[];
  return mapEstimate(headers[0], lines);
}

export async function listEstimates(filter: EstimateListFilter = {}): Promise<EstimateSummary[]> {
  const sql = db();
  const status = filter.status ?? null;
  const customerId = filter.customerId ?? null;
  const serviceRequestId = filter.serviceRequestId ?? null;
  const headers = (await sql.query(
    `SELECT ${HEADER_SELECT}
     WHERE ($1::text IS NULL OR e.status = $1::text)
       AND ($2::uuid IS NULL OR e.customer_id = $2::uuid)
       AND ($3::uuid IS NULL OR e.service_request_id = $3::uuid)
     ORDER BY e.created_at DESC, e.id`,
    [status, customerId, serviceRequestId],
  )) as HeaderRow[];
  return headers.map(toSummary);
}

function computeLineTotals(lines: EstimateDraftInput['lineItems']): number[] {
  return lines.map((li) =>
    divRoundHalfUp(BigInt(li.quantityHundredths) * BigInt(li.unitPriceCents), 100n),
  );
}

function linesPayload(input: EstimateDraftInput, lineTotals: number[]) {
  return input.lineItems.map((li, position) => ({
    position,
    item_code: li.itemCode,
    description: li.description,
    item_version_id: li.itemVersionId,
    quantity_hundredths: li.quantityHundredths,
    unit_price_cents: li.unitPriceCents,
    taxable: li.taxable,
    line_total_cents: lineTotals[position],
    area_id: li.areaId,
    price_origin: li.priceOrigin,
    catalog_item_id: li.catalogItemId,
    release_id: li.releaseId,
  }));
}

function computeFinancialTotals(input: EstimateDraftInput): Totals {
  return computeTotals(
    input.lineItems.map((li) => ({
      unitPriceCents: li.unitPriceCents,
      quantityHundredths: li.quantityHundredths,
      taxable: li.taxable,
    })),
    {
      discountMillipercent: input.discountMillipercent,
      surchargeCents: input.surchargeCents,
      taxRateMillipercent: input.taxRateMillipercent,
    },
  );
}

export async function createEstimate(
  input: EstimateDraftInput,
  ctx: CreateEstimateContext,
): Promise<EstimateRecord> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const prefix = await estimatePrefix();
  const totals = computeFinancialTotals(input);
  const lineTotals = computeLineTotals(input.lineItems);

  const rows = (await sql.query(
    `WITH allocated AS (
       SELECT allocate_document_number('estimate') AS n
     ),
     header AS (
       INSERT INTO estimates
         (organization_id, document_number, display_id, customer_id, service_request_id, status,
          title, notes, scope, exclusions, areas,
          discount_millipercent, surcharge_cents, tax_rate_millipercent, deposit_cents,
          subtotal_cents, taxable_subtotal_cents, discount_cents,
          taxable_after_discount_cents, tax_cents, total_cents,
          money_version)
       SELECT app_require_organization_id(), allocated.n,
              $1 || lpad(allocated.n::text, 4, '0'),
              $2, $3, 'draft',
              $4, $5, $6, $7, $8,
              $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18,
              $19
       FROM allocated
       RETURNING id
     ),
     inserted_lines AS (
       INSERT INTO estimate_line_items
         (organization_id, estimate_id, position, item_code, description, item_version_id,
          quantity_hundredths, unit_price_cents, taxable, line_total_cents,
          area_id, price_origin, catalog_item_id, release_id)
       SELECT app_require_organization_id(), header.id, x.position, x.item_code, x.description,
              x.item_version_id::uuid, x.quantity_hundredths, x.unit_price_cents, x.taxable,
              x.line_total_cents, x.area_id, x.price_origin,
              x.catalog_item_id::uuid, x.release_id::uuid
       FROM jsonb_to_recordset($20::jsonb)
            AS x(position int, item_code text, description text, item_version_id text,
                  quantity_hundredths bigint, unit_price_cents bigint, taxable boolean,
                  line_total_cents bigint, area_id text, price_origin text,
                  catalog_item_id text, release_id text)
       CROSS JOIN header
     ),
     logged AS (
       INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
       SELECT app_require_organization_id(), header.id, 'created', $21,
              jsonb_build_object('request_ip', $22::text, 'user_agent', $23::text)
       FROM header
     )
     SELECT header.id FROM header`,
    [
      `${prefix}-`,
      ctx.customerId,
      ctx.serviceRequestId,
      input.customer.project,
      input.notes,
      input.scope,
      input.exclusions,
      JSON.stringify(input.areas ?? []),
      input.discountMillipercent,
      input.surchargeCents,
      input.taxRateMillipercent,
      input.depositCents,
      totals.subtotalCents,
      totals.taxableSubtotalCents,
      totals.discountCents,
      totals.taxableAfterDiscountCents,
      totals.taxCents,
      totals.totalCents,
      CURRENT_MONEY_VERSION,
      JSON.stringify(linesPayload(input, lineTotals)),
      actorId,
      ctx.ip,
      ctx.userAgent,
    ],
  )) as HeaderRow[];
  const created = await getEstimate(rows[0].id as string);
  return created!;
}

export async function updateEstimate(
  id: string,
  input: EstimateDraftInput,
  expectedUpdatedAt: string,
  ctx: EstimateEventContext,
): Promise<{ ok: true; value: EstimateRecord } | { ok: false; reason: 'not-found' | 'conflict' | 'locked' }> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const current = (await sql.query(
    `SELECT status, to_json(updated_at) AS updated_at_token FROM estimates WHERE id = $1`,
    [id],
  )) as HeaderRow[];
  if (!current.length) return { ok: false, reason: 'not-found' };
  if (current[0].status !== 'draft') return { ok: false, reason: 'locked' };
  if (timestampToken(current[0], 'updated_at') !== expectedUpdatedAt) return { ok: false, reason: 'conflict' };

  const totals = computeFinancialTotals(input);
  const lineTotals = computeLineTotals(input.lineItems);

  // Header UPDATE, line delete/replace, and event log ride one data-modifying
  // CTE, so a raced 0-row header match guarantees none of the sibling writes
  // ran either — no partial application is possible.
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE estimates SET
         title = $2, notes = $3, scope = $4, exclusions = $5, areas = $6,
         discount_millipercent = $7, surcharge_cents = $8,
         tax_rate_millipercent = $9, deposit_cents = $10,
         subtotal_cents = $11, taxable_subtotal_cents = $12, discount_cents = $13,
         taxable_after_discount_cents = $14, tax_cents = $15, total_cents = $16,
         updated_at = now()
       WHERE id = $1 AND status = 'draft' AND updated_at = $17::timestamptz
       RETURNING id
     ),
     inserted AS (
       INSERT INTO estimate_line_items
         (organization_id, estimate_id, position, item_code, description, item_version_id,
          quantity_hundredths, unit_price_cents, taxable, line_total_cents,
          area_id, price_origin, catalog_item_id, release_id)
       SELECT app_require_organization_id(), $1, x.position, x.item_code, x.description,
              x.item_version_id::uuid, x.quantity_hundredths, x.unit_price_cents, x.taxable,
              x.line_total_cents, x.area_id, x.price_origin,
              x.catalog_item_id::uuid, x.release_id::uuid
       FROM jsonb_to_recordset($18::jsonb)
            AS x(position int, item_code text, description text, item_version_id text,
                  quantity_hundredths bigint, unit_price_cents bigint, taxable boolean,
                  line_total_cents bigint, area_id text, price_origin text,
                  catalog_item_id text, release_id text)
       WHERE EXISTS (SELECT 1 FROM updated)
       ON CONFLICT (estimate_id, position) DO UPDATE SET
         item_code = EXCLUDED.item_code,
         description = EXCLUDED.description,
         item_version_id = EXCLUDED.item_version_id,
         quantity_hundredths = EXCLUDED.quantity_hundredths,
         unit_price_cents = EXCLUDED.unit_price_cents,
         taxable = EXCLUDED.taxable,
         line_total_cents = EXCLUDED.line_total_cents,
         area_id = EXCLUDED.area_id,
         price_origin = EXCLUDED.price_origin,
         catalog_item_id = EXCLUDED.catalog_item_id,
         release_id = EXCLUDED.release_id
     ),
     pruned AS (
       DELETE FROM estimate_line_items
       WHERE estimate_id = $1
         AND position NOT IN (
           SELECT position FROM jsonb_to_recordset($18::jsonb) AS x(position int)
         )
         AND EXISTS (SELECT 1 FROM updated)
     ),
     logged AS (
       INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
       SELECT app_require_organization_id(), id, 'updated', $19,
               jsonb_build_object('request_ip', $20::text, 'user_agent', $21::text)
       FROM updated
     )
     SELECT id FROM updated`,
    [
      id,
      input.customer.project,
      input.notes,
      input.scope,
      input.exclusions,
      JSON.stringify(input.areas ?? []),
      input.discountMillipercent,
      input.surchargeCents,
      input.taxRateMillipercent,
      input.depositCents,
      totals.subtotalCents,
      totals.taxableSubtotalCents,
      totals.discountCents,
      totals.taxableAfterDiscountCents,
      totals.taxCents,
      totals.totalCents,
      expectedUpdatedAt,
      JSON.stringify(linesPayload(input, lineTotals)),
      actorId,
      ctx.ip,
      ctx.userAgent,
    ],
  )) as HeaderRow[];
  if (!rows.length) return { ok: false, reason: 'conflict' };

  const fresh = await getEstimate(id);
  return { ok: true, value: fresh! };
}

export async function signEstimate(
  id: string,
  args: { signerName: string; signatureContext: string; signatureImage?: string | null },
  ctx: EstimateEventContext,
): Promise<{ ok: true; value: EstimateRecord } | { ok: false; reason: 'not-found' | 'locked' | 'invalid-context' }> {
  if (args.signatureContext !== 'protected-published') return { ok: false, reason: 'invalid-context' };
  const signatureImage = args.signatureImage ?? null;
  if (signatureImage !== null && signatureImage.length > 262144) {
    return { ok: false, reason: 'invalid-context' };
  }

  const current = await getEstimate(id);
  if (!current) return { ok: false, reason: 'not-found' };
  if (!canTransition(current.status, 'signed')) return { ok: false, reason: 'locked' };

  // Build and hash the immutable document from a fresh authoritative recompute.
  const frozen = {
    displayId: current.displayId,
    documentTemplateVersion: current.documentTemplateVersion,
    customer: current.customer,
    scope: current.scope,
    exclusions: current.exclusions,
    discountMillipercent: current.discountMillipercent,
    surchargeCents: current.surchargeCents,
    taxRateMillipercent: current.taxRateMillipercent,
    depositCents: current.depositCents,
    moneyVersion: current.moneyVersion,
    lineItems: current.lineItems,
    totals: current.totals,
  };
  const hash = contentHash(frozen);

  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE estimates
       SET status = 'signed', signed_by_name = $2, signed_at = now(),
           content_hash = $3, updated_at = now(),
           customer_name = $4, customer_phone = $5, customer_email = $6,
           customer_address = $7, customer_town = $8,
           signature_context = $9, signature_image = $10
       WHERE id = $1 AND status = 'draft' AND updated_at = $11::timestamptz
       RETURNING id
     ),
     logged AS (
       INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
       SELECT app_require_organization_id(), id, 'signed', $12,
               jsonb_build_object('content_hash', $3::text, 'request_ip', $13::text, 'user_agent', $14::text)
       FROM updated
     )
     SELECT id FROM updated`,
    [
      id,
      args.signerName,
      hash,
      current.customer.name,
      current.customer.phone,
      current.customer.email,
      current.customer.address,
      current.customer.town,
      args.signatureContext,
      signatureImage,
      current.updatedAt,
      actorId,
      ctx.ip,
      ctx.userAgent,
    ],
  )) as HeaderRow[];
  if (!rows.length) return { ok: false, reason: 'locked' };
  const signed = await getEstimate(id);
  return { ok: true, value: signed! };
}

export async function declineEstimate(
  id: string,
  ctx: EstimateEventContext,
): Promise<{ ok: true; value: EstimateRecord } | { ok: false; reason: 'not-found' | 'locked' }> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const current = (await sql.query('SELECT status FROM estimates WHERE id = $1', [id])) as HeaderRow[];
  if (!current.length) return { ok: false, reason: 'not-found' };
  if (!canTransition(current[0].status as EstimateStatus, 'declined')) return { ok: false, reason: 'locked' };

  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE estimates SET status = 'declined', declined_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING id
     ),
     logged AS (
       INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
       SELECT app_require_organization_id(), id, 'declined', $2,
               jsonb_build_object('request_ip', $3::text, 'user_agent', $4::text)
       FROM updated
     )
     SELECT id FROM updated`,
    [id, actorId, ctx.ip, ctx.userAgent],
  )) as HeaderRow[];
  if (!rows.length) return { ok: false, reason: 'locked' };
  const declined = await getEstimate(id);
  return { ok: true, value: declined! };
}

export async function duplicateEstimate(id: string, ctx: EstimateEventContext): Promise<EstimateRecord | null> {
  const source = await getEstimate(id);
  if (!source) return null;

  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const prefix = await estimatePrefix();

  const rows = (await sql.query(
    `WITH allocated AS (
       SELECT allocate_document_number('estimate') AS n
     ),
     header AS (
       INSERT INTO estimates
         (organization_id, document_number, display_id, customer_id, service_request_id, status,
          title, notes, scope, exclusions, areas,
          discount_millipercent, surcharge_cents, tax_rate_millipercent, deposit_cents,
          subtotal_cents, taxable_subtotal_cents, discount_cents,
          taxable_after_discount_cents, tax_cents, total_cents,
          money_version)
       SELECT app_require_organization_id(), allocated.n,
              $1 || lpad(allocated.n::text, 4, '0'),
              $2, $3, 'draft',
              $4, $5, $6, $7, $8,
              $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18,
              $19
       FROM allocated
       RETURNING id
     ),
     inserted_lines AS (
       INSERT INTO estimate_line_items
         (organization_id, estimate_id, position, item_code, description, item_version_id,
          quantity_hundredths, unit_price_cents, taxable, line_total_cents,
          area_id, price_origin, catalog_item_id, release_id)
       SELECT app_require_organization_id(), header.id, x.position, x.item_code, x.description,
              x.item_version_id::uuid, x.quantity_hundredths, x.unit_price_cents, x.taxable,
              x.line_total_cents, x.area_id, x.price_origin,
              x.catalog_item_id::uuid, x.release_id::uuid
       FROM jsonb_to_recordset($20::jsonb)
            AS x(position int, item_code text, description text, item_version_id text,
                  quantity_hundredths bigint, unit_price_cents bigint, taxable boolean,
                  line_total_cents bigint, area_id text, price_origin text,
                  catalog_item_id text, release_id text)
       CROSS JOIN header
     ),
     logged AS (
       INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
       SELECT app_require_organization_id(), header.id, 'duplicated', $21,
              jsonb_build_object('source', $22::text, 'request_ip', $23::text, 'user_agent', $24::text)
       FROM header
     )
     SELECT header.id FROM header`,
    [
      `${prefix}-`,
      source.customerId,
      source.serviceRequestId,
      source.title,
      source.notes,
      source.scope,
      source.exclusions,
      JSON.stringify(source.areas ?? []),
      source.discountMillipercent,
      source.surchargeCents,
      source.taxRateMillipercent,
      source.depositCents,
      source.totals.subtotalCents,
      source.totals.taxableSubtotalCents,
      source.totals.discountCents,
      source.totals.taxableAfterDiscountCents,
      source.totals.taxCents,
      source.totals.totalCents,
      CURRENT_MONEY_VERSION,
      JSON.stringify(source.lineItems.map((li, position) => ({
        position,
        item_code: li.itemCode,
        description: li.description,
        item_version_id: li.itemVersionId,
        quantity_hundredths: li.quantityHundredths,
        unit_price_cents: li.unitPriceCents,
        taxable: li.taxable,
        line_total_cents: li.lineTotalCents,
        area_id: li.areaId,
        price_origin: li.priceOrigin,
        catalog_item_id: li.catalogItemId,
        release_id: li.releaseId,
      }))),
      actorId,
      id,
      ctx.ip,
      ctx.userAgent,
    ],
  )) as HeaderRow[];
  return getEstimate(rows[0].id as string);
}
