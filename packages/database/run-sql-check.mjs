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

// Splits a script into top-level statements, honoring single quotes, dollar
// quoting, and comments, so semicolons inside DO blocks are not treated as
// statement boundaries.
function splitStatements(source) {
  const statements = [];
  let current = '';
  let i = 0;
  let state = 'normal';

  const isDollarStart = (pos) => {
    if (source[pos] !== '$') return null;
    let j = pos + 1;
    while (/[A-Za-z0-9_]/.test(source[j] ?? '')) j += 1;
    return source[j] === '$' ? j : null;
  };

  while (i < source.length) {
    const char = source[i];

    if (state === 'normal') {
      if (char === '-' && source[i + 1] === '-') {
        state = 'line-comment';
        i += 2;
        continue;
      }
      if (char === '/' && source[i + 1] === '*') {
        state = 'block-comment';
        i += 2;
        continue;
      }
      if (char === "'") {
        state = 'single-quote';
        current += char;
        i += 1;
        continue;
      }
      const dollarEnd = isDollarStart(i);
      if (dollarEnd !== null) {
        state = `dollar:${source.slice(i, dollarEnd + 1)}`;
        current += source.slice(i, dollarEnd + 1);
        i = dollarEnd + 1;
        continue;
      }
      if (char === ';') {
        if (current.trim()) statements.push(current.trim());
        current = '';
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'normal';
        current += '\n';
      }
      i += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && source[i + 1] === '/') {
        state = 'normal';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'single-quote') {
      if (char === "'" && source[i + 1] === "'") {
        current += "''";
        i += 2;
        continue;
      }
      if (char === "'") {
        state = 'normal';
        current += char;
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (state.startsWith('dollar:')) {
      const tag = state.slice('dollar:'.length);
      if (source.startsWith(tag, i)) {
        current += tag;
        state = 'normal';
        i += tag.length;
        continue;
      }
      current += char;
      i += 1;
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
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
