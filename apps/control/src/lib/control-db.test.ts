import { beforeEach, describe, expect, it, vi } from 'vitest';

const { statements, released, behavior } = vi.hoisted(() => ({
  statements: [] as string[],
  released: { count: 0 },
  behavior: { failOn: undefined as string | undefined },
}));

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

vi.mock('@/lib/control-env', () => ({
  controlDatabaseUrl: () => 'postgres://control:test@localhost/control',
}));

import { controlQuery, provision } from '@/lib/control-db';

beforeEach(() => {
  statements.length = 0;
  released.count = 0;
  behavior.failOn = undefined;
});

describe('control-db', () => {
  it('runs a control query in one transaction under control_app', async () => {
    await controlQuery('SELECT 1');
    expect(statements).toEqual([
      'BEGIN',
      'SET LOCAL ROLE control_app',
      'SELECT 1',
      'COMMIT',
    ]);
    expect(released.count).toBe(1);
  });

  it('switches roles only on change within a provisioning transaction', async () => {
    await provision([
      { role: 'control_app', text: 'INSERT INTO organizations ...' },
      { role: 'control_app', text: 'SELECT set_application_context(...)' },
      { role: 'contractor_app', text: 'INSERT INTO configuration_versions ...' },
      { role: 'contractor_app', text: 'INSERT INTO price_book_releases ...' },
    ]);
    expect(statements).toEqual([
      'BEGIN',
      'SET LOCAL ROLE control_app',
      'INSERT INTO organizations ...',
      'SELECT set_application_context(...)',
      'SET LOCAL ROLE contractor_app',
      'INSERT INTO configuration_versions ...',
      'INSERT INTO price_book_releases ...',
      'COMMIT',
    ]);
  });

  it('rolls back and releases the connection when a statement fails', async () => {
    behavior.failOn = 'price_book_releases';
    await expect(provision([
      { role: 'control_app', text: 'INSERT INTO organizations ...' },
      { role: 'contractor_app', text: 'INSERT INTO price_book_releases ...' },
    ])).rejects.toThrow('boom');
    expect(statements).toEqual([
      'BEGIN',
      'SET LOCAL ROLE control_app',
      'INSERT INTO organizations ...',
      'SET LOCAL ROLE contractor_app',
      'INSERT INTO price_book_releases ...',
      'ROLLBACK',
    ]);
    expect(released.count).toBe(1);
  });
});
