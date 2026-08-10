import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUpload, saveUpload, storageRoot } from '@/lib/storage';

describe('storage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jbox-storage-'));
    process.env.STORAGE_DIR = dir;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
  });

  it('points at the configured storage root', () => {
    expect(storageRoot()).toBe(dir);
  });

  it('saves a photo and reads it back with the same bytes', async () => {
    const key = await saveUpload(Buffer.from('hello-photo'), 'jpg');
    expect(key).toMatch(/^requests\/[0-9a-f-]+\.jpg$/);
    expect((await readUpload(key)).toString()).toBe('hello-photo');
  });

  it('sanitizes an extension that is not a safe token', async () => {
    const key = await saveUpload(Buffer.from('x'), '../../../etc/passwd');
    expect(key.endsWith('.bin')).toBe(true);
  });

  it('refuses keys that escape the storage root', async () => {
    await expect(readUpload('../secret')).rejects.toThrow();
    await expect(readUpload('/etc/passwd')).rejects.toThrow();
  });
});
