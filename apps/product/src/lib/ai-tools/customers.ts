import 'server-only';

import { getCustomer, searchCustomers } from '@/lib/customers';
import { authorizeRisk } from '@contractor-platform/ai/agent';
import type { AiToolDefinition } from '@contractor-platform/ai/agent';

type SearchInput = { query: string; limit?: number };
type GetInput = { customerId: string };

function validSearchInput(input: unknown): input is SearchInput {
  if (!input || typeof input !== 'object') return false;
  const value = input as SearchInput;
  return typeof value.query === 'string'
    && (value.limit === undefined || Number.isInteger(value.limit));
}

function validGetInput(input: unknown): input is GetInput {
  return Boolean(input && typeof input === 'object' && typeof (input as GetInput).customerId === 'string');
}

export const searchCustomersTool: AiToolDefinition<SearchInput, Awaited<ReturnType<typeof searchCustomers>>> = {
  name: 'search_customers',
  description: 'Search the current organization\'s customer directory by name, phone, email, address, or town.',
  risk: 'read',
  requiresConfirmation: false,
  authorize: (context) => authorizeRisk(context, 'read'),
  execute: async (_context, input) => {
    if (!validSearchInput(input)) throw new Error('Invalid search_customers input');
    return searchCustomers(input.query, input.limit ?? 20);
  },
};

export const getCustomerTool: AiToolDefinition<GetInput, Awaited<ReturnType<typeof getCustomer>>> = {
  name: 'get_customer',
  description: 'Retrieve one customer from the current organization by customer ID.',
  risk: 'read',
  requiresConfirmation: false,
  authorize: (context) => authorizeRisk(context, 'read'),
  execute: async (_context, input) => {
    if (!validGetInput(input)) throw new Error('Invalid get_customer input');
    return getCustomer(input.customerId);
  },
};
