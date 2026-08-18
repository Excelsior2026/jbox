import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROTATION_GRACE_PERIOD_MS,
  getAllSecrets,
  getCurrentSecret,
  getRotatingSecretConfig,
  rotateSecret,
} from '@/lib/secret-rotation';

describe('secret-rotation', () => {
  it('parses current version and previous keys correctly', () => {
    const config = getRotatingSecretConfig('v2', 'secret-v2', JSON.stringify([
      { version: 'v1', secret: 'secret-v1', createdAt: 1000, deprecatedAt: Date.now() + 10000 },
    ]));

    expect(config.currentVersion).toBe('v2');
    expect(getCurrentSecret(config)).toBe('secret-v2');
    expect(getAllSecrets(config)).toEqual(['secret-v2', 'secret-v1']);
  });

  it('filters out deprecated secrets beyond expiration', () => {
    const config = getRotatingSecretConfig('v2', 'secret-v2', JSON.stringify([
      { version: 'v1', secret: 'secret-v1', createdAt: 1000, deprecatedAt: Date.now() - 5000 },
    ]));

    expect(getAllSecrets(config)).toEqual(['secret-v2']);
  });

  it('rotateSecret applies grace period to previous secret', () => {
    const initialConfig = getRotatingSecretConfig('v1', 'initial-secret', '');
    const rotated = rotateSecret(initialConfig, 'v2', 60000);

    expect(rotated.currentVersion).toBe('v2');
    expect(rotated.versions).toHaveLength(2);
    expect(rotated.versions[0].version).toBe('v2');
    expect(rotated.versions[1].version).toBe('v1');
    expect(rotated.versions[1].deprecatedAt).toBeGreaterThan(Date.now());
    expect(getAllSecrets(rotated)).toHaveLength(2);
  });
});
