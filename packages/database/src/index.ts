/**
 * Forward-only migrations plus live integrity, RLS, and provisioning checks.
 *
 * Migrations are checksum-guarded: editing an applied migration fails
 * `npm run db:migrate` rather than silently diverging from the deployed
 * schema. Migrations 001 (foundation: tenancy, roles, isolation) and 002
 * (customers, estimates) are written and applied on all three Neon branches;
 * the decisions that shaped 001 are recorded in
 * docs/architecture/foundation-decisions.md. See docs/DATABASE_SETUP.md for
 * the owner/runtime role model that migrations run under.
 */
export {};
