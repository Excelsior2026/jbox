import { beforeEach, describe, expect, it, vi } from 'vitest';

const { neonMock, statements } = vi.hoisted(() => ({
  neonMock: vi.fn(),
  statements: [] as string[],
}));

vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }));

const CONTEXT = {
  organizationId: '11111111-1111-1111-1111-111111111111',
  actorId: null,
  requestId: '440b7258-2800-46ea-b6de-13857e1f10e8',
};

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => CONTEXT,
}));

/** Records every statement issued inside a transaction. */
function recordingClient() {
  const transaction = (build: (tx: unknown) => unknown[]) => {
    const tx = Object.assign(
      (strings: TemplateStringsArray) => {
        statements.push(strings.join('?').replace(/\s+/g, ' ').trim());
        return {};
      },
      {
        query: (statement: string) => {
          statements.push(statement.replace(/\s+/g, ' ').trim());
          return {};
        },
      },
    );
    return Promise.resolve(build(tx).map(() => []));
  };
  return Object.assign(() => ({}), { query: () => Promise.resolve([]), transaction });
}

beforeEach(() => {
  statements.length = 0;
  neonMock.mockReset();
  neonMock.mockImplementation(() => recordingClient());
  process.env.DATABASE_URL = 'postgresql://jbox_runtime@example.test/jbox';
  vi.resetModules();
});

describe('db (tenant-scoped)', () => {
  it('assumes contractor_app before anything else runs', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    expect(statements[0]).toBe('SET LOCAL ROLE contractor_app');
  });

  it('establishes tenant context before the caller query', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    const contextIndex = statements.findIndex((s) => s.includes('set_application_context'));
    const queryIndex = statements.findIndex((s) => s.includes('FROM estimates'));
    expect(contextIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(contextIndex);
  });

  it('returns only the caller rows, not the prelude results', async () => {
    const { db } = await import('@/lib/db');

    const [rows] = await db().transaction((sql) => [sql.query('SELECT 1 FROM estimates')]);

    expect(rows).toEqual([]);
  });
});

describe('platformDb (cross-tenant)', () => {
  it('assumes platform_runtime', async () => {
    const { platformDb } = await import('@/lib/db');

    await platformDb().query('SELECT 1 FROM organizations');

    expect(statements[0]).toBe('SET LOCAL ROLE platform_runtime');
  });

  // platform_runtime holds no BYPASSRLS by design, so setting a tenant context
  // here would silently scope a cross-tenant job to one organization.
  it('sets no tenant context', async () => {
    const { platformDb } = await import('@/lib/db');

    await platformDb().query('SELECT 1 FROM organizations');

    expect(statements.some((s) => s.includes('set_application_context'))).toBe(false);
  });

  it('never issues cross-tenant work as the bare connecting role', async () => {
    const { platformDb } = await import('@/lib/db');

    await platformDb().query('SELECT 1 FROM organizations');

    expect(statements.indexOf('SET LOCAL ROLE platform_runtime')).toBe(0);
  });
});
