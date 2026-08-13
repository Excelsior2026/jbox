import type { NextRequest } from 'next/server';
import {
  OnboardingError,
  buildProvisionContract,
  provisionTenantViaControlPlane,
  validateSubmitInput,
} from '@/lib/onboarding';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/onboarding — the self-serve signup. Validates the wizard
 * input, builds the provisioning contract, and hands it to the control plane,
 * which creates the tenant atomically in 'provisioning' state. The storefront
 * stays offline until DNS is verified and the tenant is activated (by design).
 *
 * A hidden honeypot field ('company_website') catches bots: a filled value is
 * answered with a success-shaped response and writes nothing.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'request body must be JSON' }, { status: 400 });
  }

  const record = body as Record<string, unknown> | null;
  const honeypot = typeof record?.company_website === 'string' && record.company_website.trim();
  if (honeypot) {
    return Response.json({ ok: true, tenant: null }, { status: 201 });
  }

  if (!rateLimit(`onboarding:submit:${ip}`, { capacity: 5, refillPerMinute: 0.1 })) {
    return Response.json({ ok: false, error: 'Too many signups from this address. Try again later.' }, { status: 429 });
  }

  try {
    const input = validateSubmitInput(body);
    const contract = buildProvisionContract(input);
    const tenant = await provisionTenantViaControlPlane(contract);
    return Response.json(
      {
        ok: true,
        tenant,
        next: 'We are setting up your storefront. Activation follows after domain verification.',
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof OnboardingError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'signup could not be completed right now' }, { status: 500 });
  }
}
