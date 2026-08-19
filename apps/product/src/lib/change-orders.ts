import 'server-only';

import { DEFAULT_DOCUMENT_PREFIXES } from '@contractor-platform/configuration';
import { db } from '@/lib/db';
import { getEstimate } from '@/lib/estimates';
import { getJob } from '@/lib/jobs';
import { requireOrganizationContext } from '@/lib/organization-context-store';
import { loadInForceConfig } from '@/lib/tenant';
import type {
  ChangeOrderInput,
  ChangeOrderLineInput,
  ChangeOrderStatus,
} from '@/lib/change-order-contract';

export type ChangeOrderRecord = {
  id: string;
  displayId: string;
  estimateId: string;
  jobId: string;
  title: string;
  notes: string;
  originalTotalCents: number;
  changeAmountCents: number;
  newTotalCents: number;
  status: ChangeOrderStatus;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

export type ChangeOrderLineRecord = {
  id: string;
  position: number;
  itemCode: string;
  description: string;
  itemVersionId: string | null;
  quantityHundredths: number;
  unitPriceCents: number;
  taxable: boolean;
  lineTotalCents: number;
  action: 'add' | 'modify' | 'remove';
  originalLineItemId: string | null;
};

export type ChangeOrderSummary = Pick<
  ChangeOrderRecord,
  | 'id'
  | 'displayId'
  | 'estimateId'
  | 'jobId'
  | 'title'
  | 'originalTotalCents'
  | 'changeAmountCents'
  | 'newTotalCents'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
>;

export type ChangeOrderEventContext = {
  ip: string | null;
  userAgent: string | null;
};

export type CreateChangeOrderFailure =
  | 'estimate-not-found'
  | 'estimate-not-signed'
  | 'job-required'
  | 'job-not-found'
  | 'job-cancelled'
  | 'validation-error';

export type CreateChangeOrderResult =
  | { ok: true; value: ChangeOrderRecord }
  | { ok: false; reason: CreateChangeOrderFailure; detail?: string };

type ChangeOrderRow = Record<string, unknown>;

const timestampToken = (row: ChangeOrderRow, column: 'created_at' | 'updated_at' | 'approved_at' | 'rejected_at') => {
  const exactToken = row[`${column}_token`];
  if (typeof exactToken === 'string') return exactToken;
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
};

function mapChangeOrder(row: ChangeOrderRow): ChangeOrderRecord {
  return {
    id: row.id as string,
    displayId: row.display_id as string,
    estimateId: row.estimate_id as string,
    jobId: row.job_id as string,
    title: row.title as string,
    notes: (row.notes as string) ?? '',
    originalTotalCents: Number(row.original_total_cents),
    changeAmountCents: Number(row.change_amount_cents),
    newTotalCents: Number(row.new_total_cents),
    status: row.status as ChangeOrderStatus,
    approvedAt: row.approved_at ? timestampToken(row, 'approved_at') : null,
    rejectedAt: row.rejected_at ? timestampToken(row, 'rejected_at') : null,
    rejectionReason: (row.rejection_reason as string) ?? null,
    reason: (row.reason as string) ?? '',
    createdAt: timestampToken(row, 'created_at'),
    updatedAt: timestampToken(row, 'updated_at'),
  };
}

function toSummary(row: ChangeOrderRow): ChangeOrderSummary {
  const co = mapChangeOrder(row);
  return {
    id: co.id,
    displayId: co.displayId,
    estimateId: co.estimateId,
    jobId: co.jobId,
    title: co.title,
    originalTotalCents: co.originalTotalCents,
    changeAmountCents: co.changeAmountCents,
    newTotalCents: co.newTotalCents,
    status: co.status,
    createdAt: co.createdAt,
    updatedAt: co.updatedAt,
  };
}

const CHANGE_ORDER_HEADER_SELECT = `
  co.*,
  to_json(co.created_at) AS created_at_token,
  to_json(co.updated_at) AS updated_at_token,
  to_json(co.approved_at) AS approved_at_token,
  to_json(co.rejected_at) AS rejected_at_token
FROM change_orders AS co
`;

export async function listChangeOrders(estimateId: string): Promise<ChangeOrderSummary[]> {
  const sql = db();
  const rows = (await sql.query(
    `SELECT ${CHANGE_ORDER_HEADER_SELECT}
     WHERE co.estimate_id = $1
     ORDER BY co.created_at DESC, co.id`,
    [estimateId],
  )) as ChangeOrderRow[];
  return rows.map(toSummary);
}

export async function getChangeOrder(id: string): Promise<ChangeOrderRecord | null> {
  const sql = db();
  const rows = (await sql.query(
    `SELECT ${CHANGE_ORDER_HEADER_SELECT} WHERE co.id = $1`,
    [id],
  )) as ChangeOrderRow[];
  if (!rows.length) return null;
  return mapChangeOrder(rows[0]);
}

export async function getChangeOrderLines(changeOrderId: string): Promise<ChangeOrderLineRecord[]> {
  const sql = db();
  const rows = (await sql.query(
    `SELECT
       col.id, col.position, col.item_code, col.description, col.item_version_id,
       col.quantity_hundredths, col.unit_price_cents, col.taxable, col.line_total_cents,
       col.action, col.original_line_item_id
     FROM change_order_line_items AS col
     WHERE col.change_order_id = $1
     ORDER BY col.position, col.id`,
    [changeOrderId],
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    position: r.position as number,
    itemCode: r.item_code as string,
    description: r.description as string,
    itemVersionId: (r.item_version_id as string) ?? null,
    quantityHundredths: Number(r.quantity_hundredths),
    unitPriceCents: Number(r.unit_price_cents),
    taxable: r.taxable as boolean,
    lineTotalCents: Number(r.line_total_cents),
    action: r.action as 'add' | 'modify' | 'remove',
    originalLineItemId: (r.original_line_item_id as string) ?? null,
  }));
}

function computeLineTotalCents(unitPriceCents: number, quantityHundredths: number): number {
  return Math.round((unitPriceCents * quantityHundredths) / 100);
}

export async function createChangeOrder(
  estimateId: string,
  input: ChangeOrderInput,
  ctx: ChangeOrderEventContext,
): Promise<CreateChangeOrderResult> {
  const estimate = await getEstimate(estimateId);
  if (!estimate) return { ok: false, reason: 'estimate-not-found' };
  if (estimate.status !== 'signed') return { ok: false, reason: 'estimate-not-signed' };
  if (!estimate.jobId) return { ok: false, reason: 'job-required' };

  const jobId = estimate.jobId;
  const job = await getJob(jobId);
  if (!job) return { ok: false, reason: 'job-not-found' };
  if (job.status === 'cancelled') return { ok: false, reason: 'job-cancelled' };

  const changeAmountCents = input.lineItems.reduce((sum: number, li: ChangeOrderLineInput) => {
    const lineTotal = computeLineTotalCents(li.unitPriceCents, li.quantityHundredths);
    if (li.action === 'remove') return sum - lineTotal;
    return sum + lineTotal;
  }, 0);

  const newTotalCents = estimate.totals.totalCents + changeAmountCents;
  if (newTotalCents < 0) {
    return { ok: false, reason: 'validation-error', detail: 'Change would result in negative total.' };
  }

  const sql = db();
  const actorId = requireOrganizationContext().actorId;
  const config = await loadInForceConfig();
  const prefix = config?.documents.prefixes.changeOrder ?? DEFAULT_DOCUMENT_PREFIXES.changeOrder;

  const inserted = (await sql`
    WITH allocated AS (
      SELECT allocate_document_number('change_order') AS n
    ),
    inserted AS (
      INSERT INTO change_orders
        (organization_id, estimate_id, job_id, document_number, display_id,
         title, notes, original_total_cents, change_amount_cents, new_total_cents,
         status, reason)
      VALUES (
        app_require_organization_id(), ${estimateId}::uuid, ${jobId}::uuid,
        (SELECT n FROM allocated),
        ${`${prefix}-`} || lpad((SELECT n FROM allocated)::text, 4, '0'),
        ${input.title}, ${input.notes},
        ${estimate.totals.totalCents}, ${changeAmountCents}, ${newTotalCents},
        'draft', ${input.reason}
      )
      RETURNING id
    ),
    event_logged AS (
      INSERT INTO change_order_events (organization_id, change_order_id, event, actor_id, meta)
      SELECT app_require_organization_id(), inserted.id, 'created', ${actorId},
             jsonb_build_object('estimate_id', ${estimateId}::text,
                                'job_id', ${jobId}::text,
                                'request_ip', ${ctx.ip}::text,
                                'user_agent', ${ctx.userAgent}::text)
      FROM inserted
      RETURNING change_order_id
    ),
    estimate_logged AS (
      INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
      SELECT app_require_organization_id(), ${estimateId}::uuid, 'change_order_created', ${actorId},
             jsonb_build_object('change_order_id', inserted.id::text,
                                'request_ip', ${ctx.ip}::text,
                                'user_agent', ${ctx.userAgent}::text)
      FROM inserted
      RETURNING estimate_id
    )
    SELECT id FROM inserted
  `) as { id: string }[];

  if (!inserted.length) {
    return { ok: false, reason: 'validation-error', detail: 'Failed to insert change order.' };
  }

  const changeOrderId = inserted[0].id;

  for (const li of input.lineItems) {
    const lineTotal = computeLineTotalCents(li.unitPriceCents, li.quantityHundredths);
    await sql`
      INSERT INTO change_order_line_items
        (organization_id, change_order_id, position, item_code, description, item_version_id,
         quantity_hundredths, unit_price_cents, taxable, line_total_cents, action, original_line_item_id)
      VALUES (
        app_require_organization_id(), ${changeOrderId}::uuid,
        ${li.position}, ${li.itemCode}, ${li.description},
        ${li.itemVersionId ?? null}::uuid,
        ${li.quantityHundredths}, ${li.unitPriceCents}, ${li.taxable},
        ${lineTotal}, ${li.action},
        ${li.originalLineItemId ?? null}::uuid
      )
    `;
  }

  const created = await getChangeOrder(changeOrderId);
  if (!created) throw new Error('Created change order could not be read.');
  return { ok: true, value: created };
}

export async function submitChangeOrderForApproval(
  id: string,
  ctx: ChangeOrderEventContext,
): Promise<{ ok: true; value: ChangeOrderRecord } | { ok: false; reason: string }> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;

  const rows = (await sql`
    UPDATE change_orders
    SET status = 'pending_approval', updated_at = now()
    WHERE id = ${id}::uuid
      AND organization_id = app_require_organization_id()
      AND status = 'draft'
    RETURNING id
  `) as { id: string }[];

  if (!rows.length) {
    return { ok: false, reason: 'Change order not found or not in draft status.' };
  }

  await sql`
    INSERT INTO change_order_events (organization_id, change_order_id, event, actor_id, meta)
    VALUES (app_require_organization_id(), ${id}::uuid, 'submitted_for_approval', ${actorId},
            jsonb_build_object('request_ip', ${ctx.ip}::text, 'user_agent', ${ctx.userAgent}::text))
  `;

  const updated = await getChangeOrder(id);
  if (!updated) throw new Error('Change order could not be read after update.');
  return { ok: true, value: updated };
}

export async function approveChangeOrder(
  id: string,
  ctx: ChangeOrderEventContext,
): Promise<{ ok: true; value: ChangeOrderRecord } | { ok: false; reason: string }> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;

  const rows = (await sql`
    UPDATE change_orders
    SET status = 'approved', approved_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
      AND organization_id = app_require_organization_id()
      AND status = 'pending_approval'
    RETURNING id
  `) as { id: string }[];

  if (!rows.length) {
    return { ok: false, reason: 'Change order not found or not pending approval.' };
  }

  await sql`
    INSERT INTO change_order_events (organization_id, change_order_id, event, actor_id, meta)
    VALUES (app_require_organization_id(), ${id}::uuid, 'approved', ${actorId},
            jsonb_build_object('request_ip', ${ctx.ip}::text, 'user_agent', ${ctx.userAgent}::text))
  `;

  await sql`
    INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
    SELECT app_require_organization_id(), co.estimate_id, 'change_order_approved', ${actorId},
           jsonb_build_object('change_order_id', co.id::text,
                              'request_ip', ${ctx.ip}::text, 'user_agent', ${ctx.userAgent}::text)
    FROM change_orders co
    WHERE co.id = ${id}::uuid
  `;

  const updated = await getChangeOrder(id);
  if (!updated) throw new Error('Change order could not be read after update.');
  return { ok: true, value: updated };
}

export async function rejectChangeOrder(
  id: string,
  reason: string,
  ctx: ChangeOrderEventContext,
): Promise<{ ok: true; value: ChangeOrderRecord } | { ok: false; reason: string }> {
  const sql = db();
  const actorId = requireOrganizationContext().actorId;

  const rows = (await sql`
    UPDATE change_orders
    SET status = 'rejected', rejected_at = now(), rejection_reason = ${reason}, updated_at = now()
    WHERE id = ${id}::uuid
      AND organization_id = app_require_organization_id()
      AND status IN ('draft', 'pending_approval')
    RETURNING id
  `) as { id: string }[];

  if (!rows.length) {
    return { ok: false, reason: 'Change order not found or not in rejectable status.' };
  }

  await sql`
    INSERT INTO change_order_events (organization_id, change_order_id, event, actor_id, meta)
    VALUES (app_require_organization_id(), ${id}::uuid, 'rejected', ${actorId},
            jsonb_build_object('rejection_reason', ${reason}::text,
                               'request_ip', ${ctx.ip}::text, 'user_agent', ${ctx.userAgent}::text))
  `;

  await sql`
    INSERT INTO estimate_events (organization_id, estimate_id, event, actor_id, meta)
    SELECT app_require_organization_id(), co.estimate_id, 'change_order_rejected', ${actorId},
           jsonb_build_object('change_order_id', co.id::text, 'rejection_reason', ${reason}::text,
                              'request_ip', ${ctx.ip}::text, 'user_agent', ${ctx.userAgent}::text)
    FROM change_orders co
    WHERE co.id = ${id}::uuid
  `;

  const updated = await getChangeOrder(id);
  if (!updated) throw new Error('Change order could not be read after update.');
  return { ok: true, value: updated };
}
