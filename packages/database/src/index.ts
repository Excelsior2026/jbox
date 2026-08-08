/**
 * Forward-only migrations plus live integrity, RLS, and provisioning checks.
 *
 * Migrations are checksum-guarded: editing an applied migration fails
 * `npm run db:migrate` rather than silently diverging from the deployed
 * schema. Migration 001 has not been written yet — see the four decisions in
 * docs/PORTING_LEDGER.md that must be settled first.
 */
export {};
