import type { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const STEPS = [
  { key: 'request_received', label: 'Request Received' },
  { key: 'estimate_dispatched', label: 'Estimate Dispatched' },
  { key: 'work_approved', label: 'Work Approved' },
  { key: 'tech_en_route', label: 'Tech En Route' },
  { key: 'job_completed', label: 'Job Completed & Paid' },
] as const;

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
  }

  const ticket = request.nextUrl.searchParams.get('ticket');
  if (!ticket || typeof ticket !== 'string') {
    return privateJson({ error: 'ticket query parameter is required' }, 400);
  }

  // Stub response — real lookup will query service_requests by display_id.
  const currentStep = 0;

  return privateJson({
    ok: true,
    ticket,
    status: 'pending',
    steps: STEPS.map((step, index) => ({
      ...step,
      completed: index < currentStep,
      current: index === currentStep,
    })),
  });
}
