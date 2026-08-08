import { createHash } from 'node:crypto';

const NAME_PATTERN = /^(\d+)_.+\.sql$/;
const SPLIT_MARKER = /^[ \t]*--[ \t]*migrate:split[ \t]*$/m;

/**
 * Hash of the line-ending-normalized source.
 *
 * Normalizing matters: a CRLF checkout (Windows, or `* text=auto`) would
 * otherwise hash differently from the LF original and every migration would
 * read as edited-after-applying, blocking the runner on a file whose SQL never
 * actually changed.
 */
export function checksumFor(source) {
  return createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Splits a migration into the statements to run, on lines that are exactly
 * `-- migrate:split`. A line merely mentioning the marker is left alone.
 */
export function splitStatements(source) {
  return source
    .split(SPLIT_MARKER)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function migrationNumber(name) {
  const match = NAME_PATTERN.exec(name);
  if (!match) throw new Error(`Migration filename is not NNN_name.sql: ${name}`);
  return Number(match[1]);
}

/**
 * Decides what to run, or refuses.
 *
 * @param files   [{ name, source }] — every migration file on disk
 * @param applied Map<name, checksum> — the `_migrations` ledger
 * @returns [{ name, checksum, statements }] in the order they must run
 */
export function planMigrations({ files, applied }) {
  const byNumber = new Map();
  for (const entry of files) {
    const number = migrationNumber(entry.name);
    const existing = byNumber.get(number);
    if (existing) {
      const pair = [existing.name, entry.name].sort().join(', ');
      throw new Error(
        `Duplicate migration number ${String(number).padStart(3, '0')}: ${pair}. `
        + 'Two migrations cannot share a number; renumber the later one.',
      );
    }
    byNumber.set(number, entry);
  }

  const ordered = [...byNumber.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => entry);

  const onDisk = new Set(ordered.map((entry) => entry.name));
  for (const name of applied.keys()) {
    if (!onDisk.has(name)) {
      throw new Error(
        `${name} is recorded as applied but has no file on disk. `
        + 'The ledger and the repository disagree about what this database contains.',
      );
    }
  }

  // The highest already-applied migration. Anything pending below it would be
  // running out of order -- which happens routinely when two branches each add
  // a migration and one merges first.
  let highestApplied = null;
  for (const entry of ordered) {
    if (applied.has(entry.name)) highestApplied = entry;
  }

  const pending = [];
  for (const entry of ordered) {
    const recordedChecksum = applied.get(entry.name);
    const checksum = checksumFor(entry.source);

    if (recordedChecksum !== undefined) {
      if (recordedChecksum !== checksum) {
        throw new Error(
          `${entry.name} changed after it was applied. Migrations are immutable once run; `
          + 'write a new migration that alters the schema forward instead.',
        );
      }
      continue;
    }

    if (highestApplied && migrationNumber(entry.name) < migrationNumber(highestApplied.name)) {
      throw new Error(
        `${entry.name} is pending but sorts before ${highestApplied.name}, which is already `
        + 'applied. Renumber it above the applied ceiling so the order on disk matches the '
        + 'order this database actually ran.',
      );
    }

    pending.push({ name: entry.name, checksum, statements: splitStatements(entry.source) });
  }

  return pending;
}
