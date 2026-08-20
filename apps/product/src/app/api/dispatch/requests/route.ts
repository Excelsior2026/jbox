import type { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

interface DispatchRequest {
  category: string;
  workRequired: string;
  siteLocation?: string;
}

function generateTicketNumber(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `DRQ-${n}`;
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
  }

  let body: DispatchRequest;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: 'Invalid JSON body' }, 400);
  }

  const { category, workRequired, siteLocation } = body;

  const problems: string[] = [];
  if (!category || typeof category !== 'string' || !category.trim()) {
    problems.push('category is required');
  }
  if (!workRequired || typeof workRequired !== 'string' || !workRequired.trim()) {
    problems.push('workRequired is required');
  }
  if (siteLocation !== undefined && typeof siteLocation !== 'string') {
    problems.push('siteLocation must be a string');
  }
  if (problems.length) {
    return privateJson({ error: problems.join('; ') }, 400);
  }

  // Stub DB write — dispatch portal has no tenant context, so we cannot insert
  // into service_requests (which requires organization_id). The real write will
  // be added once the org-resolution path is wired up.
  return privateJson({ ok: true, ticketNumber: generateTicketNumber() }, 201);
}
