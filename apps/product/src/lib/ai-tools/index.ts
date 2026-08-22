import 'server-only';

import { AiToolRegistry } from '@contractor-platform/ai/agent';
import { getCustomerTool, searchCustomersTool } from './customers';
import { getEstimateTool, listEstimatesTool } from './estimates';
import { getScheduleTool } from './schedule';

/**
 * Creates the product-owned registry. The reusable AI package owns the
 * authorization/execution protocol; the product owns the tools and domain
 * capabilities exposed to an AI actor.
 */
export function createJBoxAiToolRegistry(): AiToolRegistry {
  const registry = new AiToolRegistry();
  registry.register(searchCustomersTool);
  registry.register(getCustomerTool);
  registry.register(getEstimateTool);
  registry.register(listEstimatesTool);
  registry.register(getScheduleTool);
  return registry;
}
