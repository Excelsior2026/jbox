/**
 * Executes one SQL check suite via node-pg.
 *
 * The check suites are psql scripts (they use \set and \echo). This runner
 * strips those psql meta-commands and executes the remaining statements against
 * DATABASE_URL_OWNER, so the suites can run without a local psql. Any failing
 * statement aborts the run with a nonzero exit, matching -v ON_ERROR_STOP=1.
 *
 *   node --env-file=.env.local packages/database/run-sql-check.mjs <file.sql>
 *
 * DESTRUCTIVE: the suites provision throwaway organizations, then ROLLBACK.
 * Point this at a development or preview branch, never production.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { splitStatements } from './sql-split.mjs';

const CHECKS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'checks');
const file = process.argv[2];
if (!file) {
  process.stderr.write('usage: run-sql-check.mjs <check-file.sql>\n');
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) {
  process.stderr.write('DATABASE_URL_OWNER is not set. See docs/DATABASE_SETUP.md.\n');
  process.exit(2);
}

const source = await readFile(join(CHECKS_DIR, file), 'utf8');

// psql meta-commands: the runner does not support them, so the suites must not
// depend on them. Strip them so a suite accidentally relying on one fails loudly
// at parse time instead of being silently skipped.
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

client.on('notice', (notice) => {
  process.stderr.write(`NOTICE: ${notice.message}\n`);
});
try {
  for (const [index, statement] of statements.entries()) {
    if (process.env.VERBOSE) process.stdout.write(`  [${index}] ${statement.slice(0, 60)}\n`);
    await client.query(statement);
  }
  process.stdout.write(`${file}: all checks passed\n`);
} catch (error) {
  const position = error.position
    ? ` (at character ${error.position})`
    : '';
  process.stderr.write(`\n${file} FAILED: ${error.message}${position}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
