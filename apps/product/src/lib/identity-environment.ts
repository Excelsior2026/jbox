export type FieldAuthState = 'configured' | 'disabled' | 'misconfigured';

/**
 * The Field workspace authenticates first-party with JWTs signed by
 * FIELD_AUTH_SECRET (HS256, jose). This module is the single place the
 * deployment's auth posture is decided from the environment.
 */

export function fieldAuthState(
  environment: NodeJS.ProcessEnv = process.env,
): FieldAuthState {
  const secret = environment.FIELD_AUTH_SECRET?.trim() ?? '';
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
  return environment.FIELD_AUTH_SECRET?.trim() ?? '';
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
