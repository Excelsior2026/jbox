import 'server-only';

import { listScheduledJobs } from '@/lib/jobs';
import { authorizeRisk } from '@contractor-platform/ai/agent';
import type { AiToolDefinition } from '@contractor-platform/ai/agent';

type ScheduleInput = {
  startInclusive: string;
  endExclusive: string;
  limit?: number;
};

function validInput(input: unknown): input is ScheduleInput {
  if (!input || typeof input !== 'object') return false;
  const value = input as ScheduleInput;
  return typeof value.startInclusive === 'string'
    && typeof value.endExclusive === 'string'
    && (value.limit === undefined || Number.isInteger(value.limit));
}

export const getScheduleTool: AiToolDefinition<ScheduleInput, Awaited<ReturnType<typeof listScheduledJobs>>> = {
  name: 'get_schedule',
  description: 'Get scheduled jobs for the current organization within a supplied ISO-8601 time interval. Use a half-open interval [startInclusive, endExclusive).',
  risk: 'read',
  requiresConfirmation: false,
  authorize: (context) => authorizeRisk(context, 'read'),
  execute: async (_context, input) => {
    if (!validInput(input)) throw new Error('Invalid get_schedule input');
    const start = new Date(input.startInclusive);
    const end = new Date(input.endExclusive);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('get_schedule requires valid ISO-8601 timestamps');
    }
    if (end <= start) throw new Error('get_schedule endExclusive must be after startInclusive');
    return listScheduledJobs(start.toISOString(), end.toISOString(), input.limit ?? 100);
  },
};
