import 'server-only';

import {
  neon,
  type NeonQueryFunction,
  type NeonQueryFunctionInTransaction,
  type NeonQueryInTransaction,
} from '@neondatabase/serverless';
import { requireOrganizationContext } from '@/lib/organization-context-store';

type TransactionQuery = NeonQueryFunctionInTransaction<false, false>;
type QueryRows = Array<Record<string, unknown>>;

let client: NeonQueryFunction<false, false> | null = null;
let tenantClient: ScopedSql | null = null;
let platformClient: ScopedSql | null = null;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function rawClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!client) client = neon(connectionString);
  return client;
}

type QueryExecutor = (queries: readonly ScopedQuery[]) => Promise<QueryRows[]>;

class ScopedQuery implements PromiseLike<QueryRows> {
  constructor(
    readonly build: (transaction: TransactionQuery) => NeonQueryInTransaction,
    private readonly execute: QueryExecutor,
  ) {}

  then<TResult1 = QueryRows, TResult2 = never>(
    onfulfilled?: ((value: QueryRows) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute([this])
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
 * Opens a transaction under `role`, runs the role's prelude, then the caller's
 * queries. Prelude results are stripped so a caller only sees its own rows.
 *
 * Everything here is transaction-scoped on purpose. Neon's pooled endpoint is
 * PgBouncer in transaction mode, so a session-scoped `SET ROLE` or
 * `set_config(..., false)` would work against a direct connection in
 * development and then leak between unrelated requests in production.
 */
function createRoleExecutor(
  role: 'contractor_app' | 'platform_runtime',
  prelude: (transaction: TransactionQuery) => NeonQueryInTransaction[],
): QueryExecutor {
  return async (queries) => {
    let preludeLength = 0;
    const results = await rawClient().transaction((transaction) => {
      const preludeQueries = [
        transaction.query(`SET LOCAL ROLE ${role}`),
        ...prelude(transaction),
      ];
      preludeLength = preludeQueries.length;
      return [...preludeQueries, ...queries.map((query) => query.build(transaction))];
    });
    return results.slice(preludeLength) as QueryRows[];
  };
}

const executeTenantQueries = createRoleExecutor('contractor_app', (transaction) => {
  const context = requireOrganizationContext();
  return [transaction`
    SELECT set_application_context(
      ${context.organizationId}::uuid,
      ${context.actorId}::uuid,
      ${context.requestId}::uuid
    )
  `];
});

// No tenant context, deliberately. platform_runtime holds no BYPASSRLS, so its
// reach comes from specific SECURITY DEFINER functions rather than a blanket
// exemption -- and setting a context here would silently scope a cross-tenant
// job to a single organization.
const executePlatformQueries = createRoleExecutor('platform_runtime', () => []);

function createScopedClient(execute: QueryExecutor): ScopedSql {
  const sql = ((
    strings: TemplateStringsArray,
    ...params: unknown[]
  ) => new ScopedQuery((transaction) => transaction(strings, ...params), execute)) as ScopedSql;

  sql.query = (query: string, params: readonly unknown[] = []) => (
    new ScopedQuery((transaction) => transaction.query(query, [...params]), execute)
  );

  sql.transaction = async (queriesOrFactory) => {
    const queries = typeof queriesOrFactory === 'function'
      ? queriesOrFactory(sql)
      : queriesOrFactory;
    return execute(queries);
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
