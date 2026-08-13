import 'server-only';

/**
 * Environment contract for the control plane.
 *
 * The control database credential is a separate restricted login
 * (jbox_control) that can assume control_app — and, for provisioning, switch to
 * contractor_app under an org context so tenant content is written through the
 * same RLS-enforced path the tenant itself uses. It is never the table owner
 * and never holds BYPASSRLS.
 */
export function controlDatabaseUrl(): string {
  const url = process.env.CONTROL_DATABASE_URL_UNPOOLED ?? process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error('CONTROL_DATABASE_URL is not configured.');
  return url;
}

export function isControlDatabaseConfigured() {
  return Boolean(process.env.CONTROL_DATABASE_URL || process.env.CONTROL_DATABASE_URL_UNPOOLED);
}

/**
 * Operators call the provisioning API with a shared secret. The minimum length
 * keeps a stray short test value from looking configured.
 */
export function isControlApiTokenConfigured() {
  const token = process.env.CONTROL_API_TOKEN;
  return Boolean(token && token.length >= 16);
}

export function controlApiToken(): string {
  if (!isControlApiTokenConfigured()) {
    throw new Error('CONTROL_API_TOKEN is not configured (minimum 16 characters).');
  }
  return process.env.CONTROL_API_TOKEN as string;
}
