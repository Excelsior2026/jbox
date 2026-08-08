import { describe, expect, it } from 'vitest';
import {
  currentOrganizationContext,
  requireOrganizationContext,
  runWithOrganizationContext,
} from './organization-context-store';

const context = (organizationId: string) => ({
  organizationId,
  actorId: null,
  requestId: '440b7258-2800-46ea-b6de-13857e1f10e8',
});

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

describe('requireOrganizationContext', () => {
  it('throws outside any context rather than falling back to a tenant', () => {
    expect(() => requireOrganizationContext()).toThrow(/no organization context/i);
  });

  it('names platformDb as the route for genuinely cross-tenant work', () => {
    expect(() => requireOrganizationContext()).toThrow(/platformDb/);
  });

  it('returns the context established by the enclosing run', async () => {
    const seen = await runWithOrganizationContext(
      context(ALPHA),
      async () => requireOrganizationContext().organizationId,
    );

    expect(seen).toBe(ALPHA);
  });
});

describe('concurrent requests', () => {
  // The property the whole isolation design rests on. A module-level "current
  // organization" would pass every sequential test and then serve one tenant's
  // data to another the moment two requests interleave across an await.
  it('keeps contexts separate when two tenants interleave', async () => {
    const observed: string[] = [];

    const tenant = (id: string, delay: number) => runWithOrganizationContext(
      context(id),
      async () => {
        await new Promise((resolve) => { setTimeout(resolve, delay); });
        observed.push(requireOrganizationContext().organizationId);
        await new Promise((resolve) => { setTimeout(resolve, delay); });
        return requireOrganizationContext().organizationId;
      },
    );

    // Interleaved on purpose: beta resumes while alpha is still suspended.
    const [alpha, beta] = await Promise.all([tenant(ALPHA, 20), tenant(BETA, 5)]);

    expect(alpha).toBe(ALPHA);
    expect(beta).toBe(BETA);
    expect(observed).toEqual([BETA, ALPHA]);
  });

  it('does not leak context to work started outside a run', async () => {
    await runWithOrganizationContext(context(ALPHA), async () => {
      expect(currentOrganizationContext()?.organizationId).toBe(ALPHA);
    });

    expect(currentOrganizationContext()).toBeUndefined();
  });
});
