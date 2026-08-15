import 'server-only';

import { generateSecret, generateURI, verifySync } from 'otplib';

import type { ApplicationRole } from '@contractor-platform/domain';

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
  return generateSecret();
}

/**
 * Returns the otpauth:// URI for QR code generation.
 */
export function getTotpUri(email: string, secret: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: email, secret });
}

/**
 * Verifies a TOTP token against a secret.
 * Allows ±1 window for clock skew.
 */
export function verifyTotpToken(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  return verifySync({ token, secret, epochTolerance: TOTP_WINDOW * 30 }).valid;
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
    role: ApplicationRole;
    displayName: string;
    // totpSecret is NOT returned here - client gets QR code via separate endpoint
  };
};

export type LoginResult =
  | { ok: true; value: { token: string; expiresAt: string; staff: AuthenticatedStaff } }
  | { ok: false; reason: 'invalid-credentials' | 'inactive' | 'not-configured' }
  | MfaRequiredResult;

export type AuthenticatedStaff = {
  platformUserId: string;
  email: string;
  displayName: string;
  organizationId: string;
  membershipId: string;
  role: ApplicationRole;
  mfaRequired: boolean;
};