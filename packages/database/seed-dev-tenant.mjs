/**
 * Applies the idempotent dev-tenant seed to the database pointed at by
 * DATABASE_URL_OWNER.
 *
 *   node --env-file=.env.local packages/database/seed-dev-tenant.mjs
 *
 * Re-runnable: every insert in seed-dev-tenant.sql is guarded, and the counters
 * it pre-seeds make later app-created documents collide with nothing.
 *
 * DEV ONLY. This seeds a throwaway-looking tenant with placeholder data. Point
 * it at a development or preview branch, never production.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { splitStatements } from './sql-split.mjs';

const DEV_ORG_ID = 'de000000-0000-0000-0000-000000000001';

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) {
  process.stderr.write('DATABASE_URL_OWNER is not set. See docs/DATABASE_SETUP.md.\n');
  process.exit(2);
}

const seedPath = join(dirname(fileURLToPath(import.meta.url)), 'seed-dev-tenant.sql');
const source = await readFile(seedPath, 'utf8');

const lines = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('\\set') && !line.trim().startsWith('\\echo'));
const statements = splitStatements(lines.join('\n'));

const client = new pg.Client({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? false
    : { rejectUnauthorized: true },
});

await client.connect();
try {
  for (const [index, statement] of statements.entries()) {
    if (process.env.VERBOSE) process.stdout.write(`  [${index}] ${statement.slice(0, 60)}\n`);
    await client.query(statement);
  }
} catch (error) {
  const position = error.position
    ? ` (at character ${error.position})`
    : '';
  process.stderr.write(`\nseed-dev-tenant.sql FAILED: ${error.message}${position}\n`);
  process.exitCode = 1;
  process.exit(1);
} finally {
  await client.end();
}

process.stdout.write(`seed-dev-tenant.sql: dev tenant seeded\n`);
process.stdout.write(`  organization_id: ${DEV_ORG_ID}\n`);
process.stdout.write(`  storefront host: paris.usejbox.com\n`);
process.stdout.write(`  next: set DEVELOPMENT_FIELD_ORGANIZATION_ID=${DEV_ORG_ID} in .env.local to drive the Field UI\n`);
