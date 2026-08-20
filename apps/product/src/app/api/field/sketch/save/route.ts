import type { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

interface PlacedElement {
  symbol_id: string;
  display_name: string;
  x: number;
  y: number;
  unit_price_cents: number;
}

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Sketch save unavailable' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid body' }, 400);
  }

  const estimateId = typeof body.estimateId === 'string' ? body.estimateId : null;
  const elements = Array.isArray(body.elements) ? body.elements as PlacedElement[] : null;

  if (!estimateId) {
    return privateJson({ error: 'estimateId is required' }, 400);
  }

  if (!elements || elements.length === 0) {
    return privateJson({ error: 'At least one element is required' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const totalCents = elements.reduce((sum, el) => sum + (el.unit_price_cents || 0), 0);

      return privateJson({
        success: true,
        estimateId,
        elementCount: elements.length,
        totalCents,
        message: 'Takeoff saved and synced to bid line items',
      });
    });
  } catch (error) {
    console.error('Failed to save takeoff:', error);
    return privateJson({ error: 'Failed to save takeoff' }, 503);
  }
}
