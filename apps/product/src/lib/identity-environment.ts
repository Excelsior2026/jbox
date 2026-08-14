import {
  getAllSecrets,
  getCurrentSecret,
  getRotatingSecretConfig,
  type RotatingSecretConfig,
} from './secret-rotation';

export type FieldAuthState = 'configured' | 'disabled' | 'misconfigured';

let cachedConfig: RotatingSecretConfig | null = null;

function getFieldAuthConfig(environment: NodeJS.ProcessEnv = process.env): RotatingSecretConfig {
  if (!cachedConfig) {
    cachedConfig = getRotatingSecretConfig(
      environment.FIELD_AUTH_KEY_VERSION?.trim() ?? 'v1',
      environment.FIELD_AUTH_SECRET?.trim() ?? '',
      environment.FIELD_AUTH_PREVIOUS_KEYS_JSON?.trim() ?? '',
    );
  }
  return cachedConfig;
}

export function clearFieldAuthConfigCache(): void {
  cachedConfig = null;
}

/**
 * The Field workspace authenticates first-party with JWTs signed by
 * FIELD_AUTH_SECRET (HS256, jose). This module is the single place the
 * deployment's auth posture is decided from the environment.
 */
export function fieldAuthState(
  environment: NodeJS.ProcessEnv = process.env,
): FieldAuthState {
  const secret = getCurrentSecret(getFieldAuthConfig(environment));
  if (!secret) return 'disabled';
  if (secret.length < 32) return 'misconfigured';
  return 'configured';
}

export function isFieldAuthConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return fieldAuthState(environment) === 'configured';
}

export function fieldAuthSecret(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return getCurrentSecret(getFieldAuthConfig(environment));
}

export function fieldAuthSecrets(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  return getAllSecrets(getFieldAuthConfig(environment));
}

export function fieldAuthKeyVersion(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return getFieldAuthConfig(environment).currentVersion;
}

/**
 * Session lifetime in minutes. The signed token and the field_sessions row share
 * this value; shortening it only affects newly issued sessions.
 */
export function fieldAuthTokenMinutes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(environment.FIELD_AUTH_TOKEN_MINUTES ?? '480', 10);
  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 60 * 24 * 7) {
    return 480;
  }
  return parsed;
}