import 'server-only';

import pg from 'pg';
import { requireOrganizationContext } from '@/lib/organization-context-store';

type QueryRows = Array<Record<string, unknown>>;
type Statement = { text: string; values: readonly unknown[] };

let pool: pg.Pool | null = null;
let tenantClient: ScopedSql | null = null;
let platformClient: ScopedSql | null = null;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED);
}

/**
 * One pool for the process lifetime.
 *
 * This is the payoff for running as a long-lived server rather than per-request
 * functions: connections are established once and reused, so the database sees
 * a small stable set of backends instead of a new one per invocation. It also
 * means we connect to Neon's DIRECT endpoint -- the pooled endpoint exists to
 * solve the problem this pool now solves, and stacking them adds a hop for
 * nothing.
 *
 * The direct endpoint lives in DATABASE_URL_UNPOOLED (the provisioned
 * DATABASE_URL is pooled); the fallback keeps a lone DATABASE_URL working for
 * setups that never provisioned a separate unpooled value.
 */
function connectionPool() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

/** Closes the pool. For graceful shutdown, so in-flight work can drain. */
export async function closeDatabasePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function templateStatement(strings: TemplateStringsArray, values: readonly unknown[]): Statement {
  const text = strings.reduce(
    (acc, part, index) => acc + part + (index < values.length ? `$${index + 1}` : ''),
    '',
  );
  return { text, values };
}

type QueryExecutor = (statements: readonly Statement[]) => Promise<QueryRows[]>;

class ScopedQuery implements PromiseLike<QueryRows> {
  constructor(
    readonly statement: Statement,
    private readonly execute: QueryExecutor,
  ) {}

  then<TResult1 = QueryRows, TResult2 = never>(
    onfulfilled?: ((value: QueryRows) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute([this.statement])
      .then((results) => results[0])
      .then(onfulfilled, onrejected);
  }
}

type ScopedSql = {
  (strings: TemplateStringsArray, ...params: unknown[]): ScopedQuery;
  query(query: string, params?: readonly unknown[]): ScopedQuery;
  transaction(
    queriesOrFactory: readonly ScopedQuery[] | ((transaction: ScopedSql) => readonly ScopedQuery[]),
  ): Promise<QueryRows[]>;
};

/**
 * Runs the caller's statements in one transaction, under `role`, after the
 * role's prelude.
 *
 * `SET LOCAL ROLE` and `set_application_context(..., true)` are both
 * transaction-scoped. That was mandatory under a transaction-mode pooler and
 * remains correct here for a stronger reason: a pooled connection is reused by
 * the next request, so anything left set at session scope would leak tenant
 * context or an assumed role across requests.
 */
function createRoleExecutor(
  role: 'contractor_app' | 'platform_runtime',
  prelude: () => Statement[],
): QueryExecutor {
  return async (statements) => {
    const client = await connectionPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      for (const statement of prelude()) {
        await client.query(statement.text, [...statement.values]);
      }
      const results: QueryRows[] = [];
      for (const statement of statements) {
        const result = await client.query(statement.text, [...statement.values]);
        results.push(result.rows as QueryRows);
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      // Best-effort: if the connection itself is broken the rollback fails too,
      // and the original error is the one worth surfacing.
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      // Always. An unreturned connection is a leak, and on a long-running
      // process it exhausts the pool rather than merely failing one request.
      client.release();
    }
  };
}

const executeTenantQueries = createRoleExecutor('contractor_app', () => {
  const context = requireOrganizationContext();
  return [{
    text: 'SELECT set_application_context($1::uuid, $2::uuid, $3::uuid)',
    values: [context.organizationId, context.actorId, context.requestId],
  }];
});

// No tenant context, deliberately. platform_runtime holds no BYPASSRLS, so its
// reach comes from specific SECURITY DEFINER functions rather than a blanket
// exemption -- and a context here would silently scope a cross-tenant job to a
// single organization.
const executePlatformQueries = createRoleExecutor('platform_runtime', () => []);

function createScopedClient(execute: QueryExecutor): ScopedSql {
  const sql = ((
    strings: TemplateStringsArray,
    ...params: unknown[]
  ) => new ScopedQuery(templateStatement(strings, params), execute)) as ScopedSql;

  sql.query = (query: string, params: readonly unknown[] = []) => (
    new ScopedQuery({ text: query, values: params }, execute)
  );

  sql.transaction = async (queriesOrFactory) => {
    const queries = typeof queriesOrFactory === 'function'
      ? queriesOrFactory(sql)
      : queriesOrFactory;
    return execute(queries.map((query) => query.statement));
  };

  return sql;
}

/** Tenant-scoped. Subject to RLS; requires organization context. */
export function db() {
  if (!tenantClient) tenantClient = createScopedClient(executeTenantQueries);
  return tenantClient;
}

/**
 * Cross-tenant client for paths that genuinely have no tenant: provider
 * webhooks, the outbox drain, health, hostname resolution. The bypass is
 * legible at the call site rather than implied by the connecting credential.
 */
export function platformDb() {
  if (!platformClient) platformClient = createScopedClient(executePlatformQueries);
  return platformClient;
}
