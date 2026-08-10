import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

/**
 * Local object storage for the MVP. The product app runs as a long-lived
 * process on a Fly machine with a persistent volume at STORAGE_DIR, so uploaded
 * request photos survive restarts and deploys. Local development writes into
 * ./uploads.
 *
 * Keys are opaque relative paths under the storage root. The schema's
 * service_request_photos.storage_key stores these keys; the schema column is
 * what makes swapping this for real object storage later a local change.
 */

/**
 * The storage root. Read at call time (not module scope) so tests can point it
 * at a temp directory per case; in production it is fixed for the process
 * lifetime.
 */
export function storageRoot(): string {
  // Dev fallback only; production sets STORAGE_DIR (Fly volume). The ignore
  // comment is turbopack's documented opt-out for this cwd-relative path.
  return process.env.STORAGE_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), 'uploads');
}

export async function saveUpload(buffer: Buffer, extension: string): Promise<string> {
  const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin';
  const key = `requests/${randomUUID()}.${safeExtension}`;
  const absolute = resolveWithinStorage(key);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer, { flag: 'wx' });
  return key;
}

export async function readUpload(key: string): Promise<Buffer> {
  return readFile(resolveWithinStorage(key));
}

function resolveWithinStorage(key: string): string {
  if (!key || key.includes('\0')) throw new Error('Invalid storage key.');
  const rawRoot = storageRoot();
  // Dev-only relative-root convenience; production STORAGE_DIR is absolute.
  const root = normalize(
    isAbsolute(rawRoot) ? rawRoot : join(/*turbopackIgnore: true*/ process.cwd(), rawRoot),
  );
  const resolved = normalize(join(root, key));
  if (!resolved.startsWith(root)) {
    throw new Error('Storage key escapes the storage root.');
  }
  return resolved;
}
