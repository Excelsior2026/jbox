import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
);
if (result.status !== 0) {
  throw new Error('Unable to enumerate repository files for secret scanning.');
}

const rules = [
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  {
    name: 'stripe-or-clerk-secret',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  {
    name: 'webhook-secret',
    pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/,
  },
  {
    name: 'vercel-blob-token',
    pattern: /\bvercel_blob_rw_[A-Za-z0-9_]{16,}\b/,
  },
  {
    name: 'resend-api-key',
    pattern: /\bre_[A-Za-z0-9_]{20,}\b/,
  },
  {
    name: 'github-token',
    pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
  },
  {
    name: 'database-url-with-password',
    pattern: /\bpostgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@[^/\s]+\/[^\s]+/,
  },
];

const syntheticFixtures = [
  'abcdefghijklmnop',
  'example.invalid',
  'not_allowed',
  'test_service_request_alerts',
  'incomplete_configuration',
  'vercel_blob_rw_test',
];

const paths = result.stdout.split('\0').filter(Boolean);
const findings = [];

for (const path of paths) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      continue;
    }
    throw error;
  }
  if (bytes.length > 2_000_000 || bytes.includes(0)) continue;
  const lines = bytes.toString('utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (syntheticFixtures.some((fixture) => line.includes(fixture))) return;
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        findings.push(`${path}:${index + 1} (${rule.name})`);
      }
    }
  });
}

if (findings.length) {
  process.stderr.write(
    `Potential committed secrets detected:\n${findings.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Secret scan passed for ${paths.length} repository files.\n`,
  );
}
