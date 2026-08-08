import { constants } from 'node:fs';
import { access, chmod, readFile, writeFile } from 'node:fs/promises';
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
const targetName = TARGETS.get(environmentName);
if (!targetName) {
  fail('Usage: node scripts/write-neon-env.mjs development|preview|production');
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
try {
  await access(target, constants.F_OK);
  fail(`${targetName} already exists; refusing to overwrite it.`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const body = [
  '# Generated locally by scripts/write-neon-env.mjs.',
  '# Gitignored. Never commit or paste these values into logs.',
  ...REQUIRED_KEYS.map((key) => `${key}=${values[key]}`),
  '',
].join('\n');

await writeFile(target, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
await chmod(target, 0o600);

// Read back only to verify the file was fully written. Never emit its contents.
const written = await readFile(target, 'utf8');
if (written.length !== body.length) fail(`${targetName} was not written completely.`);
process.stdout.write(`Wrote ${targetName} with ${REQUIRED_KEYS.length} validated values (mode 0600).\n`);
