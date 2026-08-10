import 'server-only';
import { DEFAULT_DOCUMENT_PREFIXES } from '@contractor-platform/configuration';
import type { CustomerInput } from '@/lib/customer-contract';
import { db } from '@/lib/db';
import { loadInForceConfig } from '@/lib/tenant';

export type CustomerRecord = {
  id: string;
  displayId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  town: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string; display_id: string; display_name: string;
  phone: string | null; email: string | null;
  service_address: string | null; town: string | null;
  created_at: string | Date; updated_at: string | Date;
  created_at_token?: string; updated_at_token?: string;
};

const timestampToken = (row: Row, column: 'created_at' | 'updated_at') => {
  const exact = row[`${column}_token`];
  if (typeof exact === 'string') return exact;
  const value = row[column];
  return value instanceof Date ? value.toISOString() : String(value);
};

const toRecord = (r: Row): CustomerRecord => ({
  id: r.id,
  displayId: r.display_id,
  name: r.display_name,
  phone: r.phone,
  email: r.email,
  address: r.service_address,
  town: r.town,
  createdAt: timestampToken(r, 'created_at'),
  updatedAt: timestampToken(r, 'updated_at'),
});

const nullIfBlank = (v: string) => (v.trim() === '' ? null : v.trim());

async function customerPrefix(): Promise<string> {
  const config = await loadInForceConfig();
  return config?.documents.prefixes.customer ?? DEFAULT_DOCUMENT_PREFIXES.customer;
}

export async function createCustomer(input: CustomerInput): Promise<CustomerRecord> {
  const sql = db();
  const prefix = await customerPrefix();
  const rows = (await sql.query(
    `WITH allocated AS (
       SELECT allocate_document_number('customer') AS n
     ),
     inserted AS (
       INSERT INTO customers
         (organization_id, document_number, display_id, display_name, phone, email, service_address, town)
       SELECT app_require_organization_id(), allocated.n,
              $1 || lpad(allocated.n::text, 4, '0'),
              $2, $3, $4, $5, $6
       FROM allocated
       RETURNING *, to_json(created_at) AS created_at_token, to_json(updated_at) AS updated_at_token
     )
     SELECT * FROM inserted`,
    [
      `${prefix}-`,
      input.name.trim(),
      nullIfBlank(input.phone),
      nullIfBlank(input.email),
      nullIfBlank(input.address),
      nullIfBlank(input.town),
    ],
  )) as Row[];
  return toRecord(rows[0]);
}

export async function getCustomer(id: string): Promise<CustomerRecord | null> {
  const sql = db();
  const rows = (await sql.query(
    `SELECT *,
       to_json(created_at) AS created_at_token,
       to_json(updated_at) AS updated_at_token
     FROM customers
     WHERE id = $1`,
    [id],
  )) as Row[];
  return rows.length ? toRecord(rows[0]) : null;
}

export async function listCustomers(query = '', limit = 50): Promise<CustomerRecord[]> {
  const q = query.trim();
  const like = `%${q}%`;
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const sql = db();
  const rows = (await sql.query(
    `SELECT *,
       to_json(created_at) AS created_at_token,
       to_json(updated_at) AS updated_at_token
     FROM customers
     WHERE (
       $1 = ''
       OR display_name ILIKE $2
       OR COALESCE(phone, '') ILIKE $2
       OR COALESCE(email, '') ILIKE $2
       OR COALESCE(service_address, '') ILIKE $2
       OR COALESCE(town, '') ILIKE $2
     )
     ORDER BY updated_at DESC, id
     LIMIT $3`,
    [q, like, boundedLimit],
  )) as Row[];
  return rows.map(toRecord);
}

export async function searchCustomers(query: string, limit = 20): Promise<CustomerRecord[]> {
  if (!query.trim()) return [];
  return listCustomers(query, limit);
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
  expectedUpdatedAt: string,
): Promise<
  | { ok: true; value: CustomerRecord }
  | { ok: false; reason: 'not-found' | 'conflict' }
> {
  const sql = db();
  const rows = (await sql.query(
    `UPDATE customers
     SET display_name = $2,
         phone = $3,
         email = $4,
         service_address = $5,
         town = $6,
         updated_at = now()
     WHERE id = $1
       AND updated_at = $7::timestamptz
     RETURNING *, to_json(created_at) AS created_at_token, to_json(updated_at) AS updated_at_token`,
    [
      id,
      input.name.trim(),
      nullIfBlank(input.phone),
      nullIfBlank(input.email),
      nullIfBlank(input.address),
      nullIfBlank(input.town),
      expectedUpdatedAt,
    ],
  )) as Row[];

  if (rows.length) return { ok: true, value: toRecord(rows[0]) };

  const existing = (await sql.query('SELECT id FROM customers WHERE id = $1', [id])) as { id: string }[];
  return existing.length
    ? { ok: false, reason: 'conflict' }
    : { ok: false, reason: 'not-found' };
}
