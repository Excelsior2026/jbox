import 'server-only';

import { authenticator } from 'otplib';

/**
 * TOTP-based MFA for Field authentication.
 * Uses otplib (RFC 6238, 30-second windows, SHA1, 6-digit codes).
 */

export const TOTP_ISSUER = 'J-Box Field';
export const TOTP_WINDOW = 1; // Allow ±1 window (30s each side)

/**
 * Generates a new TOTP secret (base32 encoded, 32 chars = 160 bits).
 */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Returns the otpauth:// URI for QR code generation.
 */
export function getTotpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, TOTP_ISSUER, secret);
}

/**
 * Verifies a TOTP token against a secret.
 * Allows ±1 window for clock skew.
 */
export function verifyTotpToken(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  // otplib verify accepts window as third param
  return authenticator.verify({ token, secret, window: TOTP_WINDOW });
}

/**
 * Result of password verification when MFA is required.
 */
export type MfaRequiredResult = {
  ok: false;
  reason: 'mfa-required';
  mfa: {
    userId: string;
    email: string;
    organizationId: string;
    membershipId: string;
    role: string;
    displayName: string;
    // totpSecret is NOT returned here - client gets QR code via separate endpoint
  };
};

export type LoginResult =
  | { ok: true; value: { token: string; expiresAt: string; staff: AuthenticatedStaff } }
  | { ok: false; reason: 'invalid-credentials' | 'inactive' | 'not-configured' | 'mfa-required' }
  | MfaRequiredResult;

export type AuthenticatedStaff = {
  platformUserId: string;
  email: string;
  displayName: string;
  organizationId: string;
  membershipId: string;
  role: string;
  mfaRequired: boolean;
};