import { describe, expect, it } from 'vitest';
import { checksumFor, planMigrations, splitStatements } from './migration-plan.mjs';

const file = (name, source) => ({ name, source });

describe('checksumFor', () => {
  it('is stable across line endings so a CRLF checkout does not read as drift', () => {
    expect(checksumFor('SELECT 1;\nSELECT 2;\n'))
      .toBe(checksumFor('SELECT 1;\r\nSELECT 2;\r\n'));
  });

  it('changes when the SQL changes', () => {
    expect(checksumFor('SELECT 1;')).not.toBe(checksumFor('SELECT 2;'));
  });
});

describe('splitStatements', () => {
  it('splits on the migrate:split marker and drops empty segments', () => {
    const statements = splitStatements([
      'CREATE TABLE a (id int);',
      '-- migrate:split',
      '',
      '-- migrate:split',
      'CREATE TABLE b (id int);',
    ].join('\n'));

    expect(statements).toEqual(['CREATE TABLE a (id int);', 'CREATE TABLE b (id int);']);
  });

  it('does not split on the marker appearing inside a comment body', () => {
    const statements = splitStatements(
      '-- describes the migrate:split convention\nCREATE TABLE a (id int);',
    );

    expect(statements).toHaveLength(1);
  });
});

describe('planMigrations', () => {
  it('returns only the migrations that have not been applied', () => {
    const plan = planMigrations({
      files: [file('001_a.sql', 'SELECT 1;'), file('002_b.sql', 'SELECT 2;')],
      applied: new Map([['001_a.sql', checksumFor('SELECT 1;')]]),
    });

    expect(plan.map((entry) => entry.name)).toEqual(['002_b.sql']);
    expect(plan[0].statements).toEqual(['SELECT 2;']);
  });

  it('refuses to run when an applied migration has been edited', () => {
    expect(() => planMigrations({
      files: [file('001_a.sql', 'SELECT 999;')],
      applied: new Map([['001_a.sql', checksumFor('SELECT 1;')]]),
    })).toThrow(/001_a\.sql.*changed after it was applied/i);
  });

  it('refuses when a migration recorded in the ledger has no file', () => {
    expect(() => planMigrations({
      files: [file('001_a.sql', 'SELECT 1;')],
      applied: new Map([
        ['001_a.sql', checksumFor('SELECT 1;')],
        ['002_gone.sql', 'deadbeef'],
      ]),
    })).toThrow(/002_gone\.sql.*recorded.*no file/i);
  });

  // Two sessions working in parallel is the normal case here, so a migration
  // that sorts before one already applied must not be silently skipped or
  // silently run out of order.
  it('refuses a pending migration that sorts before an applied one', () => {
    // The realistic shape: 001 and 003 are applied, then a branch that was cut
    // earlier merges and drops 002 in underneath. All three files exist.
    expect(() => planMigrations({
      files: [
        file('001_a.sql', 'SELECT 1;'),
        file('002_new.sql', 'SELECT 2;'),
        file('003_c.sql', 'SELECT 3;'),
      ],
      applied: new Map([
        ['001_a.sql', checksumFor('SELECT 1;')],
        ['003_c.sql', checksumFor('SELECT 3;')],
      ]),
    })).toThrow(/002_new\.sql.*before.*003_c\.sql/i);
  });

  it('refuses two migrations sharing a number', () => {
    expect(() => planMigrations({
      files: [file('003_a.sql', 'SELECT 1;'), file('003_b.sql', 'SELECT 2;')],
      applied: new Map(),
    })).toThrow(/duplicate migration number 003/i);
  });

  it('applies in numeric order rather than lexicographic', () => {
    const plan = planMigrations({
      files: [file('010_j.sql', 'SELECT 10;'), file('002_b.sql', 'SELECT 2;')],
      applied: new Map(),
    });

    expect(plan.map((entry) => entry.name)).toEqual(['002_b.sql', '010_j.sql']);
  });
});
