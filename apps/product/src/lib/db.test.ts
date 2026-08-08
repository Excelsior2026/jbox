import { beforeEach, describe, expect, it, vi } from 'vitest';

const { statements, released, behavior } = vi.hoisted(() => ({
  statements: [] as string[],
  released: { count: 0 },
  behavior: { failOn: undefined as string | undefined },
}));

// A class, not vi.fn(): db.ts calls `new pg.Pool(...)`, and a plain mock
// function is not constructible.
vi.mock('pg', () => {
  class Pool {
    async connect() {
      return {
        query: async (text: string) => {
          const normalized = String(text).replace(/\s+/g, ' ').trim();
          statements.push(normalized);
          if (behavior.failOn && normalized.includes(behavior.failOn)) {
            throw new Error('boom');
          }
          return { rows: [] };
        },
        release: () => { released.count += 1; },
      };
    }
  }
  return { default: { Pool } };
});

const CONTEXT = {
  organizationId: '11111111-1111-1111-1111-111111111111',
  actorId: null,
  requestId: '440b7258-2800-46ea-b6de-13857e1f10e8',
};

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => CONTEXT,
}));

beforeEach(() => {
  statements.length = 0;
  released.count = 0;
  behavior.failOn = undefined;
  process.env.DATABASE_URL = 'postgresql://jbox_runtime@example.test/jbox';
  vi.resetModules();
});

describe('db (tenant-scoped)', () => {
  it('opens a transaction and assumes contractor_app inside it', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe('SET LOCAL ROLE contractor_app');
  });

  it('establishes tenant context before the caller query, and commits', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    const contextIndex = statements.findIndex((s) => s.includes('set_application_context'));
    const queryIndex = statements.findIndex((s) => s.includes('FROM estimates'));
    expect(contextIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(contextIndex);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('returns only the caller rows, not the prelude results', async () => {
    const { db } = await import('@/lib/db');

    const [rows] = await db().transaction((sql) => [sql.query('SELECT 1 FROM estimates')]);

    expect(rows).toEqual([]);
  });

  // A pooled connection that is not returned is a connection leak, and on a
  // long-running process that exhausts the pool rather than merely erroring.
  it('rolls back and releases the connection when a query fails', async () => {
    behavior.failOn = 'FROM estimates';
    const { db } = await import('@/lib/db');

    await expect(db().query('SELECT 1 FROM estimates')).rejects.toThrow('boom');

    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(released.count).toBe(1);
  });

  it('releases the connection on success too', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    expect(released.count).toBe(1);
  });
});

describe('platformDb (cross-tenant)', () => {
  it('assumes platform_runtime inside the transaction', async () => {
    const { platformDb } = await import('@/lib/db');

    await platformDb().query('SELECT 1 FROM organizations');

    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe('SET LOCAL ROLE platform_runtime');
  });

  // platform_runtime holds no BYPASSRLS by design, so setting a tenant context
  // here would silently scope a cross-tenant job to one organization.
  it('sets no tenant context', async () => {
    const { platformDb } = await import('@/lib/db');

    await platformDb().query('SELECT 1 FROM organizations');

    expect(statements.some((s) => s.includes('set_application_context'))).toBe(false);
  });
});
