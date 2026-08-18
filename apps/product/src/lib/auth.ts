import 'server-only';

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';
import type { ApplicationRole } from '@contractor-platform/domain';
import { capabilitiesForRole } from '@contractor-platform/domain';
import { platformDb } from '@/lib/db';
import { fieldAuthSecret, fieldAuthSecrets, fieldAuthTokenMinutes } from '@/lib/identity-environment';
import { verifyTotpToken, generateTotpSecret, getTotpUri, type LoginResult, type AuthenticatedStaff } from '@/lib/mfa';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * First-party Field authentication. Ports TrueTraining's auth-service pattern
 * (JWT with tenant + role claims, jti-keyed revocation, role-change revocation)
 * onto the jbox identity store:
 *
 *   - platform_users.password_hash is the credential (scrypt, not bcrypt: the
 *     same KDF discipline, built into Node, no native dependency).
 *   - field_sessions is the active-session ledger. A token is valid only while
 *     its jti row exists, is not revoked, and has not expired; logout revokes
 *     it; a role/status change revokes every session for the user.
 *   - Every verification re-reads the live membership, so a role change takes
 *     effect on the next request even before explicit revocation (TrueTraining's
 *     /me re-reads the DB for the same reason).
 *
 * Auth is cross-tenant by construction: login and verification run on
 * platformDb() with no tenant context, through the SECURITY DEFINER windows from
 * migration 007. The tenant boundary is enforced by the membership RLS, not by
 * the token.
 */

export const FIELD_SESSION_COOKIE = 'field_session';
export const FIELD_TOKEN_ISSUER = 'usejbox:field';
export const FIELD_TOKEN_AUDIENCE = 'usejbox:field';

const MIN_PASSWORD_LENGTH = 8;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('Password must be at least 8 characters long.');
  }
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const key = await deriveKey(password, salt);
  return formatScryptHash(key, salt);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseScryptHash(stored);
  if (!parsed) return false;
  const candidate = await deriveKey(password, parsed.salt);
  const storedKey = Buffer.from(parsed.key, 'base64url');
  if (candidate.length !== storedKey.length) return false;
  return timingSafeEqual(candidate, storedKey);
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return Buffer.from(await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  }));
}

function formatScryptHash(key: Buffer, salt: Buffer): string {
  return [
    'scrypt',
    SCRYPT_N, SCRYPT_R, SCRYPT_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

function parseScryptHash(stored: string): { salt: Buffer; key: string } | null {
  const parts = stored.split('$');
  if (
    parts.length !== 6
    || parts[0] !== 'scrypt'
    || parts[1] !== String(SCRYPT_N)
    || parts[2] !== String(SCRYPT_R)
    || parts[3] !== String(SCRYPT_P)
  ) {
    return null;
  }
  try {
    return { salt: Buffer.from(parts[4], 'base64url'), key: parts[5] };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JWT issue / verify
// ---------------------------------------------------------------------------

export type FieldTokenClaims = {
  sub: string;
  email: string;
  organization_id: string;
  role: ApplicationRole;
  jti: string;
  iat: number;
  exp: number;
};

async function tokenSigningKey(secret: string): Promise<Uint8Array> {
  // HS256 requires a key of at least 32 bytes. The config check enforces the
  // length; deriving a fixed-width key here keeps the guard in one place even
  // for secrets longer than the minimum.
  return createHash('sha256').update(secret).digest();
}

export async function signFieldToken(claims: Omit<FieldTokenClaims, 'iat' | 'exp'>): Promise<string> {
  const secret = fieldAuthSecret();
  if (!secret) throw new Error('field_auth_not_configured');
  const ttlMinutes = fieldAuthTokenMinutes();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: claims.email,
    organization_id: claims.organization_id,
    role: claims.role,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(FIELD_TOKEN_ISSUER)
    .setAudience(FIELD_TOKEN_AUDIENCE)
    .setJti(claims.jti)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlMinutes * 60)
    .sign(await tokenSigningKey(secret));
}

export async function verifyFieldToken(
  token: string,
): Promise<{ claims: FieldTokenClaims } | null> {
  const secrets = fieldAuthSecrets();
  if (secrets.length === 0) return null;

  for (const secret of secrets) {
    try {
      const { payload } = await jwtVerify(token, await tokenSigningKey(secret), {
        issuer: FIELD_TOKEN_ISSUER,
        audience: FIELD_TOKEN_AUDIENCE,
      });
      const { sub, email, organization_id: organizationId, role, jti } = payload;
      if (
        typeof sub !== 'string'
        || typeof email !== 'string'
        || typeof organizationId !== 'string'
        || typeof role !== 'string'
        || typeof jti !== 'string'
        || typeof payload.iat !== 'number'
        || typeof payload.exp !== 'number'
      ) {
        continue;
      }
      if (role !== 'owner' && role !== 'office' && role !== 'technician') continue;
      return {
        claims: {
          sub, email, organization_id: organizationId, role, jti,
          iat: payload.iat, exp: payload.exp,
        },
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session ledger
// ---------------------------------------------------------------------------

// Types are imported from '@/lib/mfa' to avoid circular dependency
// export type AuthenticatedStaff = { ... }
// export type LoginResult = { ... }

/**
 * Authenticates email + password against an organization and issues a session.
 * Runs cross-tenant (platform_runtime): the credential and the active membership
 * are read together through the staff_login_lookup window, so a login can never
 * distinguish a wrong password from a missing user (enumeration-safe, SEC-09).
 */
export async function loginWithPassword(options: {
  email: string;
  password: string;
  organizationId: string;
  totpToken?: string;
}): Promise<LoginResult> {
  const email = options.email.trim().toLowerCase();
  if (!email || !options.password || !options.organizationId) {
    return { ok: false, reason: 'invalid-credentials' };
  }

  const rows = (await platformDb().query(
    `SELECT
       platform_user_id, email, display_name, password_hash,
       membership_id, role, mfa_required, totp_secret
     FROM staff_login_lookup($1::text, $2::uuid)`,
    [email, options.organizationId],
  )) as Array<{
    platform_user_id: string;
    email: string;
    display_name: string;
    password_hash: string | null;
    membership_id: string;
    role: ApplicationRole;
    mfa_required: boolean;
    totp_secret: string | null;
  }>;
  const credential = rows[0];
  if (!credential || !credential.password_hash) {
    return { ok: false, reason: 'invalid-credentials' };
  }
  if (!(await verifyPassword(options.password, credential.password_hash))) {
    return { ok: false, reason: 'invalid-credentials' };
  }

  // MFA required - verify TOTP token if provided, otherwise return mfa-required challenge
  if (credential.mfa_required) {
    if (!options.totpToken) {
      return {
        ok: false,
        reason: 'mfa-required',
        mfa: {
          userId: credential.platform_user_id,
          email: credential.email,
          organizationId: options.organizationId,
          membershipId: credential.membership_id,
          role: credential.role,
          displayName: credential.display_name,
        },
      };
    }
    if (!credential.totp_secret || !verifyTotpToken(options.totpToken, credential.totp_secret)) {
      return { ok: false, reason: 'invalid-credentials' };
    }
  }

  const jti = createHash('sha256').update(`${credential.platform_user_id}:${randomBytes(16).toString('hex')}`).digest('hex').slice(0, 40);
  const ttlMinutes = fieldAuthTokenMinutes();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60_000);

  await platformDb().query(
    `INSERT INTO field_sessions (jti, platform_user_id, organization_id, role, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [jti, credential.platform_user_id, options.organizationId, credential.role, issuedAt.toISOString(), expiresAt.toISOString()],
  );

  const token = await signFieldToken({
    sub: credential.platform_user_id,
    email: credential.email,
    organization_id: options.organizationId,
    role: credential.role,
    jti,
  });

  return {
    ok: true,
    value: {
      token,
      expiresAt: expiresAt.toISOString(),
      staff: {
        platformUserId: credential.platform_user_id,
        email: credential.email,
        displayName: credential.display_name,
        organizationId: options.organizationId,
        membershipId: credential.membership_id,
        role: credential.role,
        mfaRequired: credential.mfa_required,
      },
    },
  };
}

/**
 * Resolves a session token to a live principal, or null. Fails closed:
 * unverifiable signature, expired token, revoked/missing session row, or a
 * membership that is no longer active all yield null. The live role is read
 * from the database on every request, so the principal always reflects the
 * current membership even when the token's role claim is stale.
 */
export async function resolveStaffFromToken(
  token: string,
): Promise<AuthenticatedStaff | null> {
  const verified = await verifyFieldToken(token);
  if (!verified) return null;
  const { claims } = verified;

  const sessionRows = (await platformDb().query(
    `SELECT id
       FROM field_sessions
      WHERE jti = $1
        AND revoked_at IS NULL
        AND expires_at > now()`,
    [claims.jti],
  )) as Array<{ id: string }>;
  if (!sessionRows[0]) return null;

  const membershipRows = (await platformDb().query(
    `SELECT membership_id, role, mfa_required, display_name
       FROM staff_session_membership($1::uuid, $2::uuid)`,
    [claims.sub, claims.organization_id],
  )) as Array<{ membership_id: string; role: ApplicationRole; mfa_required: boolean; display_name: string }>;
  const membership = membershipRows[0];
  if (!membership) return null;

  return {
    platformUserId: claims.sub,
    email: claims.email,
    displayName: membership.display_name,
    organizationId: claims.organization_id,
    membershipId: membership.membership_id,
    role: membership.role,
    mfaRequired: membership.mfa_required,
  };
}

/** Revokes the session for the given token (logout). No-ops on unknown tokens. */
export async function revokeFieldSession(token: string): Promise<void> {
  const verified = await verifyFieldToken(token);
  if (!verified) return;
  await platformDb().query(
    `UPDATE field_sessions
        SET revoked_at = now()
      WHERE jti = $1
        AND revoked_at IS NULL
        AND expires_at > now()`,
    [verified.claims.jti],
  );
}

/** Revokes every active session for a staff member (role/status change). */
export async function revokeAllSessionsForStaff(platformUserId: string): Promise<void> {
  await platformDb().query(
    'SELECT revoke_field_sessions_for_user($1::uuid)',
    [platformUserId],
  );
}

export type StaffMembershipOption = {
  organizationId: string;
  membershipId: string;
  role: ApplicationRole;
  displayName: string;
  email: string;
};

/**
 * Active organizations for an email (used to disambiguate a login that did not
 * name an organization). Returns memberships for active users/memberships/orgs
 * only; an email with none reads as invalid credentials, not as a leak.
 */
export async function listActiveMembershipsForEmail(
  email: string,
): Promise<StaffMembershipOption[]> {
  const rows = (await platformDb().query(
    `SELECT organization_id, membership_id, role, mfa_required, display_name, email
       FROM staff_memberships_for_email($1::text)`,
    [email.trim().toLowerCase()],
  )) as Array<{
    organization_id: string;
    membership_id: string;
    role: ApplicationRole;
    mfa_required: boolean;
    display_name: string;
    email: string;
  }>;
  return rows.map((row) => ({
    organizationId: row.organization_id,
    membershipId: row.membership_id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
  }));
}

export async function verifyUserGlobalPassword(
  email: string,
  password: string,
): Promise<{ ok: true; platformUserId: string } | { ok: false }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) return { ok: false };

  const rows = (await platformDb().query(
    'SELECT platform_user_id, password_hash FROM staff_user_credential_lookup($1::text)',
    [normalizedEmail],
  )) as Array<{ platform_user_id: string; password_hash: string | null }>;

  const user = rows[0];
  if (!user || !user.password_hash) return { ok: false };

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return { ok: false };

  return { ok: true, platformUserId: user.platform_user_id };
}

// ---------------------------------------------------------------------------
// MFA Enrollment
// ---------------------------------------------------------------------------

export type MfaSetupResult =
  | { ok: true; value: { secret: string; uri: string } }
  | { ok: false; reason: 'unauthenticated' | 'already-enrolled' | 'not-configured' };

/**
 * Initiates MFA enrollment for the current user. Returns a new TOTP secret
 * and otpauth:// URI for QR code generation.
 */
export async function initiateMfaEnrollment(
  platformUserId: string,
  email: string,
): Promise<MfaSetupResult> {
  const secret = generateTotpSecret();
  const uri = getTotpUri(email, secret);

  await platformDb().query(
    'SELECT staff_mfa_initiate($1::uuid, $2::text)',
    [platformUserId, secret],
  );

  return { ok: true, value: { secret, uri } };
}

/**
 * Completes MFA enrollment by verifying the first TOTP code.
 * If verification succeeds, marks mfa_required = true on the membership.
 */
export async function completeMfaEnrollment(
  platformUserId: string,
  organizationId: string,
  totpToken: string,
): Promise<{ ok: boolean; reason?: string }> {
  const userRows = (await platformDb().query(
    `SELECT totp_secret FROM staff_user_credential_lookup(
       (SELECT email FROM platform_users WHERE id = $1::uuid)
     )`,
    [platformUserId],
  )) as Array<{ totp_secret: string | null }>;
  const user = userRows[0];
  if (!user?.totp_secret || !verifyTotpToken(totpToken, user.totp_secret)) {
    return { ok: false, reason: 'invalid-token' };
  }

  await platformDb().query(
    'SELECT staff_mfa_complete($1::uuid, $2::uuid)',
    [platformUserId, organizationId],
  );

  return { ok: true };
}

/**
 * Disables MFA for a user (requires TOTP verification).
 */
export async function disableMfa(
  platformUserId: string,
  organizationId: string,
  totpToken: string,
): Promise<{ ok: boolean; reason?: string }> {
  const userRows = (await platformDb().query(
    `SELECT totp_secret FROM staff_user_credential_lookup(
       (SELECT email FROM platform_users WHERE id = $1::uuid)
     )`,
    [platformUserId],
  )) as Array<{ totp_secret: string | null }>;
  const user = userRows[0];
  if (!user?.totp_secret || !verifyTotpToken(totpToken, user.totp_secret)) {
    return { ok: false, reason: 'invalid-token' };
  }

  await platformDb().query(
    'SELECT staff_mfa_disable($1::uuid, $2::uuid)',
    [platformUserId, organizationId],
  );

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export function fieldSessionCookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number } {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: fieldAuthTokenMinutes() * 60,
  };
}

/** Reads the session token from the server-component cookie store. */
export async function readFieldSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(FIELD_SESSION_COOKIE)?.value ?? null;
}

/** Convenience for the login/logout responses: a JSON body with the cookie set. */
export function fieldSessionResponse(
  body: unknown,
  token: string | null,
  status = 200,
): Response {
  const response = NextResponse.json(body, { status });
  if (token) {
    response.cookies.set(FIELD_SESSION_COOKIE, token, fieldSessionCookieOptions());
  } else {
    response.cookies.set(FIELD_SESSION_COOKIE, '', {
      ...fieldSessionCookieOptions(),
      maxAge: 0,
    });
  }
  return response;
}

/** Shared capability set for a resolved principal (kept in sync with identity). */
export function capabilitiesForStaffRole(role: ApplicationRole) {
  return capabilitiesForRole(role);
}
