import 'server-only';

import pg from 'pg';
import { controlDatabaseUrl } from '@/lib/control-env';

export type ControlRole = 'control_app' | 'contractor_app';

export type ControlRows = Array<Record<string, unknown>>;

/**
 * One statement in a control-plane transaction. `role` names the application
 * role the statement runs as; the executor issues SET LOCAL ROLE (and nothing
 * else) on a change, so a single transaction can interleave control-owned rows
 * (organizations, domains) with tenant content (configuration, price book)
 * written through the tenant's own role and context.
 */
export type ControlStatement = {
  role: ControlRole;
  text: string;
  values?: readonly unknown[];
};

let pool: pg.Pool | null = null;

function connectionPool() {
  if (!pool) {
    const connectionString = controlDatabaseUrl();
    pool = new pg.Pool({
      connectionString,
      // Require SSL for all non-local connections, matching the product app's
      // db.ts behaviour. A misconfigured URL or provider change cannot silently
      // fall back to plaintext.
      ssl: /localhost|127\.0\.0\.1/.test(connectionString)
        ? false
        : { rejectUnauthorized: true },
      max: Number(process.env.CONTROL_DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

/** Closes the pool. For graceful shutdown, so in-flight work can drain. */
export async function closeControlDatabasePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Runs a sequence of statements in one transaction, issuing SET LOCAL ROLE on
 * each role change. Both SET LOCAL ROLE and set_application_context are
 * transaction-scoped, which is exactly what the control plane needs: a pooled
 * connection is reused afterwards, so nothing role- or tenant-related may leak
 * across the boundary.
 */
async function executeStatements(statements: readonly ControlStatement[]): Promise<ControlRows[]> {
  const client = await connectionPool().connect();
  try {
    await client.query('BEGIN');
    const results: ControlRows[] = [];
    let currentRole: ControlRole | null = null;
    for (const statement of statements) {
      if (statement.role !== currentRole) {
        await client.query(`SET LOCAL ROLE ${statement.role}`);
        currentRole = statement.role;
      }
      const result = await client.query(statement.text, [...(statement.values ?? [])]);
      results.push(result.rows as ControlRows);
    }
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Control-owned rows: organizations, domains, identity. Runs as control_app
 * with no tenant context.
 */
export async function controlQuery(text: string, values: readonly unknown[] = []): Promise<ControlRows> {
  const results = await executeStatements([{ role: 'control_app', text, values }]);
  return results[0];
}

/**
 * Provisioning: a multi-statement transaction that switches between control_app
 * and contractor_app. All-or-nothing; the tenant is either fully provisioned or
 * not at all.
 */
export function provision(statements: readonly ControlStatement[]): Promise<ControlRows[]> {
  return executeStatements(statements);
}
