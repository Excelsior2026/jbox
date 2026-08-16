import 'server-only';

import { currentOrganizationContext } from '@/lib/organization-context-store';

/**
 * Structured logger for server-side use.
 *
 * Every log entry carries a consistent set of fields so that production
 * log aggregators (Datadog, Loki, CloudWatch Logs Insights) can filter and
 * correlate entries by request, tenant, and actor without manual string
 * parsing.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Outbox dispatch started', { claimed: 20 });
 *   logger.error('Checkout session failed', { error: err.message, stripeCustomerId });
 *
 * Outputs newline-delimited JSON in production; pretty-prints in development.
 * Structured fields are always present; callers may add arbitrary extra fields.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

type LogEntry = {
  ts: string;
  level: LogLevel;
  msg: string;
  requestId?: string;
  organizationId?: string;
  [key: string]: unknown;
};

const isDevelopment = process.env.NODE_ENV === 'development';

function write(level: LogLevel, msg: string, extra: LogFields = {}): void {
  const ctx = currentOrganizationContext();

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.organizationId ? { organizationId: ctx.organizationId } : {}),
    ...extra,
  };

  const line = isDevelopment
    ? JSON.stringify(entry, null, 2)
    : JSON.stringify(entry);

  // Route by severity. Node.js process.stderr is unbuffered; using it for
  // warn/error keeps application logs out of stdout pipelines that treat
  // stdout as structured data.
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, extra?: LogFields) => write('debug', msg, extra),
  info: (msg: string, extra?: LogFields) => write('info', msg, extra),
  warn: (msg: string, extra?: LogFields) => write('warn', msg, extra),
  error: (msg: string, extra?: LogFields) => write('error', msg, extra),
};
