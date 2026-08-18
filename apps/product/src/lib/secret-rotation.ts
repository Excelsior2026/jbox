import { createHash } from 'node:crypto';

export type SecretVersion = {
  version: string;
  secret: string;
  createdAt: number;
  deprecatedAt?: number;
};

export type RotatingSecretConfig = {
  currentVersion: string;
  versions: SecretVersion[];
};

function parseSecretVersions(
  currentVersionEnv: string,
  currentSecretEnv: string,
  previousKeysJsonEnv: string,
): RotatingSecretConfig {
  const currentVersion = currentVersionEnv?.trim() || 'v1';
  const currentSecret = currentSecretEnv?.trim() || '';

  let previousVersions: SecretVersion[] = [];
  if (previousKeysJsonEnv?.trim()) {
    try {
      const parsed = JSON.parse(previousKeysJsonEnv.trim());
      if (Array.isArray(parsed)) {
        previousVersions = parsed.map((v) => ({
          version: String(v.version),
          secret: String(v.secret),
          createdAt: Number(v.createdAt),
          deprecatedAt: v.deprecatedAt ? Number(v.deprecatedAt) : undefined,
        }));
      }
    } catch {
      // Invalid JSON, ignore previous keys
    }
  }

  const allVersions: SecretVersion[] = [
    { version: currentVersion, secret: currentSecret, createdAt: Date.now() },
    ...previousVersions,
  ];

  return {
    currentVersion,
    versions: allVersions,
  };
}

export function getRotatingSecretConfig(
  currentVersionEnv: string,
  currentSecretEnv: string,
  previousKeysJsonEnv: string,
): RotatingSecretConfig {
  return parseSecretVersions(currentVersionEnv, currentSecretEnv, previousKeysJsonEnv);
}

export function getCurrentSecret(config: RotatingSecretConfig): string {
  const current = config.versions.find((v) => v.version === config.currentVersion);
  return current?.secret ?? '';
}

export function getAllSecrets(config: RotatingSecretConfig): string[] {
  return config.versions
    .filter((v) => v.secret && (!v.deprecatedAt || v.deprecatedAt > Date.now()))
    .map((v) => v.secret);
}

export function getSecretByVersion(config: RotatingSecretConfig, version: string): string | undefined {
  return config.versions.find((v) => v.version === version)?.secret;
}

export function isSecretDeprecated(config: RotatingSecretConfig, version: string): boolean {
  const versionInfo = config.versions.find((v) => v.version === version);
  return versionInfo?.deprecatedAt !== undefined && versionInfo.deprecatedAt <= Date.now();
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

export function generateSecretKey(_version: string): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildPreviousKeysJson(config: RotatingSecretConfig): string {
  const previous = config.versions
    .filter((v) => v.version !== config.currentVersion)
    .map((v) => ({
      version: v.version,
      secret: v.secret,
      createdAt: v.createdAt,
      deprecatedAt: v.deprecatedAt,
    }));
  return JSON.stringify(previous);
}

export const DEFAULT_ROTATION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function rotateSecret(
  config: RotatingSecretConfig,
  newVersion: string,
  gracePeriodMs: number = DEFAULT_ROTATION_GRACE_PERIOD_MS,
): RotatingSecretConfig {
  const now = Date.now();
  const newSecret = generateSecretKey(newVersion);

  const newVersions: SecretVersion[] = [
    { version: newVersion, secret: newSecret, createdAt: now },
    ...config.versions.map((v) => ({
      ...v,
      deprecatedAt: v.version === config.currentVersion ? now + gracePeriodMs : v.deprecatedAt,
    })),
  ];

  return {
    currentVersion: newVersion,
    versions: newVersions,
  };
}