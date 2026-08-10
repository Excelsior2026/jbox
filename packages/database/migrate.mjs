/**
 * Migration runner.
 *
 *   node --env-file=.env.local packages/database/migrate.mjs [--status] [--dry-run]
 *
 * Connects with DATABASE_URL_OWNER, never the runtime credential: applying DDL
 * is the one job the owner exists for, and the runtime login deliberately has
 * no privilege to do it.
 *
 * Each migration runs inside a single transaction together with its ledger
 * insert, so a migration and the record that it ran can never disagree --
 * PostgreSQL's transactional DDL is what makes that possible.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { planMigrations } from './src/migration-plan.mjs';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const argv = process.argv.slice(2);
const args = new Set(argv);
const statusOnly = args.has('--status');
const dryRun = args.has('--dry-run');

// Records migrations up to and including <name> as applied WITHOUT running
// them. For a database whose schema was built by hand before the ledger
// existed. Deliberately explicit rather than inferred: guessing which
// migrations a schema already reflects is how a ledger starts lying.
const adoptThrough = argv.find((arg) => arg.startsWith('--adopt='))?.slice('--adopt='.length);

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) {
  process.stderr.write(
    'DATABASE_URL_OWNER is not set.\n'
    + 'Migrations run as the table owner. If you are trying to use the runtime\n'
    + 'credential, that is the wrong one -- see docs/DATABASE_SETUP.md.\n',
  );
  process.exit(2);
}

function describeTarget(url) {
  // Host only. The credential must never reach a log.
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

const client = new pg.Client({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true },
});

await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // The product health probe reads the ledger as platform_runtime. _migrations
  // is created by this runner, not by a migration, so no migration grants it --
  // the read has to be granted here. It is safe to run on every invocation, which
  // is what lets branches migrated before this line pick the grant up next run.
  await client.query(
    'GRANT SELECT ON _migrations TO contractor_app, control_app, platform_runtime',
  );

  const ledger = await client.query('SELECT name, checksum FROM _migrations');
  const applied = new Map(ledger.rows.map((row) => [row.name, row.checksum]));

  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d+_.+\.sql$/.test(name));
  const files = await Promise.all(names.map(async (name) => ({
    name,
    source: await readFile(join(MIGRATIONS_DIR, name), 'utf8'),
  })));

  const pending = planMigrations({ files, applied });

  process.stdout.write(`target:  ${describeTarget(connectionString)}\n`);
  process.stdout.write(`applied: ${applied.size}\npending: ${pending.length}\n`);

  if (adoptThrough) {
    const ceiling = pending.findIndex((migration) => migration.name === adoptThrough);
    if (ceiling === -1) {
      throw new Error(
        `--adopt=${adoptThrough} does not match a pending migration. `
        + `Pending: ${pending.map((migration) => migration.name).join(', ') || '(none)'}`,
      );
    }
    const adopted = pending.slice(0, ceiling + 1);
    await client.query('BEGIN');
    try {
      for (const migration of adopted) {
        await client.query(
          'INSERT INTO _migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
        process.stdout.write(`adopted ${migration.name} (not executed)\n`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    process.exit(0);
  }

  if (statusOnly || dryRun) {
    for (const migration of pending) {
      process.stdout.write(`  would apply ${migration.name} (${migration.statements.length} statements)\n`);
    }
    if (!pending.length) process.stdout.write('  up to date\n');
    process.exit(0);
  }

  for (const migration of pending) {
    await client.query('BEGIN');
    try {
      for (const statement of migration.statements) {
        await client.query(statement);
      }
      await client.query(
        'INSERT INTO _migrations (name, checksum) VALUES ($1, $2)',
        [migration.name, migration.checksum],
      );
      await client.query('COMMIT');
      process.stdout.write(`applied ${migration.name}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      process.stderr.write(`FAILED ${migration.name}: ${error.message}\n`);
      throw error;
    }
  }

  if (!pending.length) process.stdout.write('up to date\n');
} catch (error) {
  // Operator-facing tool: a refusal is an expected outcome and should read as
  // one. A stack trace here would bury the sentence that says what to do.
  process.stderr.write(`\nmigrate: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
