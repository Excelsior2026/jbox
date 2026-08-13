import { beforeEach, describe, expect, it } from 'vitest';
import {
  FIELD_SESSION_COOKIE,
  fieldSessionCookieOptions,
  hashPassword,
  signFieldToken,
  verifyFieldToken,
  verifyPassword,
} from '@/lib/auth';

const SECRET = 'a'.repeat(48);

beforeEach(() => {
  process.env.FIELD_AUTH_SECRET = SECRET;
  process.env.NODE_ENV = 'test';
});

describe('password hashing (scrypt)', () => {
  it('round-trips a password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('salts each hash', async () => {
    const first = await hashPassword('same-password-123');
    const second = await hashPassword('same-password-123');
    expect(first).not.toBe(second);
  });

  it('rejects short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8/);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('anything-123', 'not-a-scrypt-hash')).toBe(false);
  });
});

describe('field session JWT', () => {
  const claims = {
    sub: '22222222-2222-2222-2222-222222222222',
    email: 'owner@example.com',
    organization_id: '11111111-1111-1111-1111-111111111111',
    role: 'owner' as const,
    jti: 'jti-abcdefghijklmnopqrstuvwxyz',
  };

  it('signs and verifies with issuer/audience/subject claims', async () => {
    const token = await signFieldToken(claims);
    const verified = await verifyFieldToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.claims.sub).toBe(claims.sub);
    expect(verified!.claims.email).toBe(claims.email);
    expect(verified!.claims.organization_id).toBe(claims.organization_id);
    expect(verified!.claims.role).toBe('owner');
    expect(verified!.claims.jti).toBe(claims.jti);
    expect(verified!.claims.iat).toBeGreaterThan(0);
    expect(verified!.claims.exp).toBeGreaterThan(verified!.claims.iat);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signFieldToken(claims);
    process.env.FIELD_AUTH_SECRET = 'b'.repeat(48);
    expect(await verifyFieldToken(token)).toBeNull();
  });

  it('rejects a token with a tampered payload', async () => {
    const token = await signFieldToken(claims);
    const [header, payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({
      sub: '99999999-9999-9999-9999-999999999999',
      ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
    })).toString('base64url');
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    expect(await verifyFieldToken(tampered)).toBeNull();
  });

  it('rejects a garbage token', async () => {
    expect(await verifyFieldToken('not.a.jwt')).toBeNull();
  });

  it('fails closed when no secret is configured', async () => {
    delete process.env.FIELD_AUTH_SECRET;
    await expect(signFieldToken(claims)).rejects.toThrow(/not_configured/);
    expect(await verifyFieldToken('anything')).toBeNull();
  });
});

describe('session cookie', () => {
  it('uses a fixed name and HttpOnly Lax options', () => {
    const options = fieldSessionCookieOptions();
    expect(FIELD_SESSION_COOKIE).toBe('field_session');
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
  });
});
