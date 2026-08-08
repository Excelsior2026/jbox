/**
 * Runs the SQL check suites against a database.
 *
 *   node --env-file=.env.local packages/database/verify.mjs
 *
 * The checks are psql scripts (they use \set and \echo), so this shells out to
 * psql rather than reimplementing them. The connection string is passed through
 * the child's argv from an environment variable and never interpolated into a
 * shell command, because Neon URLs contain `&` and `?`.
 *
 * DESTRUCTIVE: the checks provision throwaway organizations, then ROLLBACK.
 * Point this at a development or preview branch, never production.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'checks');

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) {
  process.stderr.write('DATABASE_URL_OWNER is not set. See docs/DATABASE_SETUP.md.\n');
  process.exit(2);
}

const psql = process.env.PSQL_BIN ?? 'psql';
const files = readdirSync(CHECKS_DIR).filter((name) => name.endsWith('.sql')).sort();

let failed = 0;
for (const file of files) {
  const result = spawnSync(
    psql,
    [connectionString, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(CHECKS_DIR, file)],
    { stdio: 'inherit', env: { ...process.env, PGCONNECT_TIMEOUT: '20' } },
  );
  if (result.status !== 0) {
    process.stderr.write(`verify: ${file} FAILED\n`);
    failed += 1;
  }
}

if (failed) {
  process.stderr.write(`\nverify: ${failed} of ${files.length} check suite(s) failed\n`);
  process.exit(1);
}
process.stdout.write(`\nverify: ${files.length} check suite(s) passed\n`);
