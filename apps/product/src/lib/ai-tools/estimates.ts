import 'server-only';

import { getEstimate, listEstimates } from '@/lib/estimates';
import { authorizeRisk } from '@contractor-platform/ai/agent';
import type { AiToolDefinition } from '@contractor-platform/ai/agent';

type GetInput = { estimateId: string };
type ListInput = { status?: string; customerId?: string; serviceRequestId?: string };

function validGetInput(input: unknown): input is GetInput {
  return Boolean(input && typeof input === 'object' && typeof (input as GetInput).estimateId === 'string');
}

function validListInput(input: unknown): input is ListInput {
  if (!input || typeof input !== 'object') return false;
  const value = input as ListInput;
  return [value.status, value.customerId, value.serviceRequestId]
    .every((field) => field === undefined || typeof field === 'string');
}

export const getEstimateTool: AiToolDefinition<GetInput, Awaited<ReturnType<typeof getEstimate>>> = {
  name: 'get_estimate',
  description: 'Retrieve one estimate from the current organization, including its authoritative calculated totals and line items.',
  risk: 'read',
  requiresConfirmation: false,
  authorize: (context) => authorizeRisk(context, 'read'),
  execute: async (_context, input) => {
    if (!validGetInput(input)) throw new Error('Invalid get_estimate input');
    return getEstimate(input.estimateId);
  },
};

export const listEstimatesTool: AiToolDefinition<ListInput, Awaited<ReturnType<typeof listEstimates>>> = {
  name: 'list_estimates',
  description: 'List estimates belonging to the current organization, optionally filtered by status, customer, or service request.',
  risk: 'read',
  requiresConfirmation: false,
  authorize: (context) => authorizeRisk(context, 'read'),
  execute: async (_context, input) => {
    if (!validListInput(input)) throw new Error('Invalid list_estimates input');
    return listEstimates({
      status: input.status as Parameters<typeof listEstimates>[0]['status'],
      customerId: input.customerId,
      serviceRequestId: input.serviceRequestId,
    });
  },
};
