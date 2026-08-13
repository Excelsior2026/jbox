import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  platformQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: mocks.platformQuery }),
  platformDb: () => ({ query: mocks.platformQuery }),
}));

import {
  hashPassword,
  loginWithPassword,
  resolveStaffFromToken,
  revokeFieldSession,
  revokeAllSessionsForStaff,
  signFieldToken,
} from '@/lib/auth';

const SECRET = 'z'.repeat(48);
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const MEMBERSHIP = '44444444-4444-4444-4444-444444444444';

const validLookupRow = {
  platform_user_id: USER,
  email: 'owner@example.com',
  display_name: 'Demo Owner',
  password_hash: '',
  membership_id: MEMBERSHIP,
  role: 'owner',
  mfa_required: false,
};

function rowForLookup(passwordHash: string): typeof validLookupRow {
  return { ...validLookupRow, password_hash: passwordHash };
}

beforeEach(() => {
  process.env.FIELD_AUTH_SECRET = SECRET;
  process.env.NODE_ENV = 'test';
  mocks.platformQuery.mockReset();
});

describe('loginWithPassword — adversarial credential paths', () => {
  it('rejects an unknown email identically to a wrong password (no enumeration)', async () => {
    mocks.platformQuery.mockResolvedValue([]);
    const result = await loginWithPassword({ email: 'nobody@example.com', password: 'whatever-123', organizationId: ORG_A });
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(mocks.platformQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong password with the same reason', async () => {
    const hash = await hashPassword('correct-horse-123');
    mocks.platformQuery.mockResolvedValue([rowForLookup(hash)]);
    const result = await loginWithPassword({ email: 'owner@example.com', password: 'wrong-password', organizationId: ORG_A });
    expect(result).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(mocks.platformQuery).toHaveBeenCalledTimes(1);
  });

  it('reads the credential only through the staff_login_lookup window', async () => {
    const hash = await hashPassword('correct-horse-123');
    mocks.platformQuery.mockResolvedValue([rowForLookup(hash)]);
    await loginWithPassword({ email: 'owner@example.com', password: 'correct-horse-123', organizationId: ORG_A });
    const [sql] = mocks.platformQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM staff_login_lookup($1::text, $2::uuid)');
  });

  it('creates a session row bound to the authenticated organization', async () => {
    const hash = await hashPassword('correct-horse-123');
    mocks.platformQuery.mockResolvedValueOnce([rowForLookup(hash)]).mockResolvedValueOnce([]);
    const result = await loginWithPassword({ email: 'owner@example.com', password: 'correct-horse-123', organizationId: ORG_A });
    expect(result.ok).toBe(true);

    const [insertSql, params] = mocks.platformQuery.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO field_sessions');
    expect(insertSql).toContain('(jti, platform_user_id, organization_id, role, issued_at, expires_at)');
    const [jti, platformUserId, organizationId, role] = params as [string, string, string, string];
    expect(jti).toMatch(/^[0-9a-f]{40}$/);
    expect(platformUserId).toBe(USER);
    expect(organizationId).toBe(ORG_A);
    expect(role).toBe('owner');
  });

  it('supports concurrent sessions: each login issues a distinct session row', async () => {
    const hash = await hashPassword('correct-horse-123');
    mocks.platformQuery
      .mockResolvedValueOnce([rowForLookup(hash)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([rowForLookup(hash)])
      .mockResolvedValueOnce([]);
    const first = await loginWithPassword({ email: 'owner@example.com', password: 'correct-horse-123', organizationId: ORG_A });
    const second = await loginWithPassword({ email: 'owner@example.com', password: 'correct-horse-123', organizationId: ORG_A });
    expect(first.ok && second.ok).toBe(true);

    const jtiOne = (mocks.platformQuery.mock.calls[1][1] as [string])[0];
    const jtiTwo = (mocks.platformQuery.mock.calls[3][1] as [string])[0];
    expect(jtiOne).not.toBe(jtiTwo);
  });
});

describe('resolveStaffFromToken — adversarial session validation', () => {
  function sessionRow() {
    return [{ id: 'session-1' }];
  }
  function membershipRow(role: 'owner' | 'office' | 'technician' = 'owner') {
    return [{ membership_id: MEMBERSHIP, role, mfa_required: false, display_name: 'Demo Owner' }];
  }

  async function validToken() {
    return signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_A, role: 'owner', jti: 'jti-adversarial-1',
    });
  }

  it('session ledger lookup requires jti, unrevoked, and unexpired (enforced in SQL)', async () => {
    const token = await validToken();
    mocks.platformQuery
      .mockResolvedValueOnce(sessionRow())
      .mockResolvedValueOnce(membershipRow());
    await resolveStaffFromToken(token);
    const [sessionSql, sessionParams] = mocks.platformQuery.mock.calls[0] as [string, unknown[]];
    expect(sessionSql).toContain('WHERE jti = $1');
    expect(sessionSql).toContain('revoked_at IS NULL');
    expect(sessionSql).toContain('expires_at > now()');
    expect(sessionParams[0]).toBe('jti-adversarial-1');
  });

  it('fails closed when the session row is revoked', async () => {
    const token = await validToken();
    mocks.platformQuery.mockResolvedValueOnce([]);
    expect(await resolveStaffFromToken(token)).toBeNull();
  });

  it('fails closed when the session row is expired (no live row)', async () => {
    const token = await validToken();
    mocks.platformQuery.mockResolvedValueOnce([]);
    expect(await resolveStaffFromToken(token)).toBeNull();
  });

  it('fails closed when the user is disabled (membership window returns no row)', async () => {
    const token = await validToken();
    mocks.platformQuery
      .mockResolvedValueOnce(sessionRow())
      .mockResolvedValueOnce([]);
    expect(await resolveStaffFromToken(token)).toBeNull();
  });

  it('fails closed on organization mismatch (token org vs live membership)', async () => {
    const token = await signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_A, role: 'owner', jti: 'jti-org-mismatch',
    });
    mocks.platformQuery
      .mockResolvedValueOnce(sessionRow())
      .mockResolvedValueOnce([]);
    const principal = await resolveStaffFromToken(token);
    expect(principal).toBeNull();
  });

  it('re-reads the live membership window bound to the token org (no cross-org escalation)', async () => {
    const token = await validToken();
    mocks.platformQuery
      .mockResolvedValueOnce(sessionRow())
      .mockResolvedValueOnce(membershipRow());
    await resolveStaffFromToken(token);
    const [, membershipParams] = mocks.platformQuery.mock.calls[1] as [string, unknown[]];
    expect(membershipParams).toEqual([USER, ORG_A]);
  });

  it('role is taken from the live membership, not the token claim (role-change revocation)', async () => {
    const token = await signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_A, role: 'technician', jti: 'jti-stale-role',
    });
    mocks.platformQuery
      .mockResolvedValueOnce(sessionRow())
      .mockResolvedValueOnce(membershipRow('owner'));
    const principal = await resolveStaffFromToken(token);
    expect(principal?.role).toBe('owner');
    expect(principal?.membershipId).toBe(MEMBERSHIP);
  });

  it('fails closed on a tampered/foreign-secret token before any database call', async () => {
    process.env.FIELD_AUTH_SECRET = 'y'.repeat(48);
    const token = await signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_A, role: 'owner', jti: 'jti-tampered',
    });
    process.env.FIELD_AUTH_SECRET = SECRET;
    expect(await resolveStaffFromToken(token)).toBeNull();
    expect(mocks.platformQuery).not.toHaveBeenCalled();
  });
});

describe('logout and replay', () => {
  it('revokeFieldSession marks the session row revoked (jti-scoped)', async () => {
    const token = await signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_A, role: 'owner', jti: 'jti-logout',
    });
    mocks.platformQuery.mockResolvedValue([]);
    await revokeFieldSession(token);
    const [sql, params] = mocks.platformQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE field_sessions');
    expect(sql).toContain('revoked_at = now()');
    expect(sql).toContain('revoked_at IS NULL');
    expect(params[0]).toBe('jti-logout');
  });

  it('a replayed token after logout no longer resolves', async () => {
    const token = await signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_A, role: 'owner', jti: 'jti-replay',
    });

    mocks.platformQuery.mockResolvedValue([]);
    await revokeFieldSession(token);

    mocks.platformQuery.mockReset();
    mocks.platformQuery.mockResolvedValueOnce([]);
    expect(await resolveStaffFromToken(token)).toBeNull();
  });

  it('revokeAllSessionsForStaff invokes the revoke window for the user', async () => {
    mocks.platformQuery.mockResolvedValue([]);
    await revokeAllSessionsForStaff(USER);
    const [sql, params] = mocks.platformQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT revoke_field_sessions_for_user($1::uuid)');
    expect(params[0]).toBe(USER);
  });
});

describe('cross-tenant token substitution', () => {
  it('a session for org A cannot resolve against org B', async () => {
    const tokenA = await signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_A, role: 'owner', jti: randomUUID(),
    });
    const tokenB = await signFieldToken({
      sub: USER, email: 'owner@example.com', organization_id: ORG_B, role: 'owner', jti: randomUUID(),
    });

    mocks.platformQuery
      .mockResolvedValueOnce([{ id: 'session' }])
      .mockResolvedValueOnce([]);
    expect(await resolveStaffFromToken(tokenA)).toBeNull();

    mocks.platformQuery.mockReset();
    mocks.platformQuery
      .mockResolvedValueOnce([{ id: 'session' }])
      .mockResolvedValueOnce(membershipFor(ORG_B));
    const principal = await resolveStaffFromToken(tokenB);
    expect(principal?.organizationId).toBe(ORG_B);
  });
});

function membershipFor(organizationId: string) {
  return [{ membership_id: MEMBERSHIP, role: 'owner', mfa_required: false, display_name: 'Demo Owner', organization_id: organizationId }];
}
