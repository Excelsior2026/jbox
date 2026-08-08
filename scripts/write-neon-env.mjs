import { constants } from 'node:fs';
import { access, chmod, lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TARGETS = new Map([
  ['development', '.env.local'],
  ['preview', '.env.neon.preview.local'],
  ['production', '.env.neon.production.local'],
]);

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'DATABASE_URL_OWNER',
  'CONTROL_DATABASE_URL',
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function validateConnectionString(name, value) {
  if (typeof value !== 'string' || value.includes('\n') || value.includes('\r')) {
    fail(`${name} must be a single connection-string value.`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid URL.`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail(`${name} must use the postgres or postgresql protocol.`);
  }
  if (!url.hostname.endsWith('.neon.tech')) {
    fail(`${name} must use a Neon hostname.`);
  }
  if (url.pathname !== '/jbox') {
    fail(`${name} must select the jbox database.`);
  }
  if (!url.password) {
    fail(`${name} must contain a generated password.`);
  }

  const isPooled = url.hostname.split('.', 1)[0].endsWith('-pooler');
  const expected = {
    DATABASE_URL: { role: 'jbox_runtime', pooled: true },
    DATABASE_URL_UNPOOLED: { role: 'jbox_runtime', pooled: false },
    DATABASE_URL_OWNER: { role: 'jbox_owner', pooled: false },
    CONTROL_DATABASE_URL: { role: 'jbox_control', pooled: true },
  }[name];

  if (decodeURIComponent(url.username) !== expected.role) {
    fail(`${name} must authenticate as ${expected.role}.`);
  }
  if (isPooled !== expected.pooled) {
    fail(`${name} has the wrong pooled/direct endpoint type.`);
  }
  if (!['require', 'verify-full'].includes(url.searchParams.get('sslmode'))) {
    fail(`${name} must require TLS certificate validation.`);
  }
}

const environmentName = process.argv[2];
const mergeExisting = process.argv[3] === '--merge';
const targetName = TARGETS.get(environmentName);
if (!targetName || (process.argv[3] && !mergeExisting)) {
  fail(
    'Usage: node scripts/write-neon-env.mjs development|preview|production [--merge]',
  );
}

let input = '';
for await (const chunk of process.stdin) input += chunk;

let values;
try {
  values = JSON.parse(input);
} catch {
  fail('Credential input must be valid JSON.');
}

if (!values || typeof values !== 'object' || Array.isArray(values)) {
  fail('Credential input must be an object.');
}
const actualKeys = Object.keys(values).sort();
if (
  actualKeys.length !== REQUIRED_KEYS.length ||
  actualKeys.some((key, index) => key !== [...REQUIRED_KEYS].sort()[index])
) {
  fail(`Credential input must contain exactly: ${REQUIRED_KEYS.join(', ')}.`);
}
for (const key of REQUIRED_KEYS) validateConnectionString(key, values[key]);

const target = resolve(process.cwd(), targetName);
let existing = '';
try {
  await access(target, constants.F_OK);
  if (!mergeExisting) {
    fail(`${targetName} already exists; use --merge to preserve unrelated values.`);
  }
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${targetName} must be a regular file, not a link.`);
  }
  existing = await readFile(target, 'utf8');
  await chmod(target, 0o600);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const retained = existing
  .split(/\r?\n/)
  .filter((line) => {
    const key = line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
    return !key || !REQUIRED_KEYS.includes(key);
  })
  .join('\n')
  .trimEnd();
const databaseBlock = [
  '# Generated locally by scripts/write-neon-env.mjs.',
  '# Gitignored. Never commit or paste these values into logs.',
  ...REQUIRED_KEYS.map((key) => `${key}=${values[key]}`),
].join('\n');
const body = `${retained ? `${retained}\n\n` : ''}${databaseBlock}\n`;

await writeFile(target, body, {
  encoding: 'utf8',
  mode: 0o600,
  flag: existing ? 'w' : 'wx',
});
await chmod(target, 0o600);

// Read back only to verify the file was fully written. Never emit its contents.
const written = await readFile(target, 'utf8');
if (written.length !== body.length) fail(`${targetName} was not written completely.`);
process.stdout.write(
  `${existing ? 'Merged into' : 'Wrote'} ${targetName} with ${REQUIRED_KEYS.length} validated values (mode 0600).\n`,
);
