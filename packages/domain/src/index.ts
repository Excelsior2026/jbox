/**
 * Roles, capabilities, tenancy, and module identity.
 *
 * This package answers "who may do what, and which parts of the product does
 * this tenant have" and holds no I/O.
 */

export type DeploymentMode = 'saas' | 'dedicated';

export type ApplicationRole = 'owner' | 'office' | 'technician';

export type Capability =
  | 'customers.read'
  | 'customers.write'
  | 'service_requests.read'
  | 'service_requests.update'
  | 'estimates.read'
  | 'estimates.prepare'
  | 'estimates.send'
  | 'estimates.approve'
  | 'jobs.read'
  | 'jobs.write'
  | 'jobs.schedule'
  | 'price_book.read'
  | 'price_book.manage'
  | 'price_book.publish'
  | 'invoices.read'
  | 'invoices.open'
  | 'invoices.send'
  | 'receipts.read'
  | 'receipts.record'
  | 'inventory.read'
  | 'inventory.adjust'
  | 'inventory.count'
  | 'exports.create'
  | 'users.manage'
  | 'organization.configure'
  | 'safety_policy.approve'
  | 'audit.read';

export const ROLE_CAPABILITIES = {
  owner: [
    'customers.read', 'customers.write',
    'service_requests.read', 'service_requests.update',
    'estimates.read', 'estimates.prepare', 'estimates.send', 'estimates.approve',
    'jobs.read', 'jobs.write', 'jobs.schedule',
    'price_book.read', 'price_book.manage', 'price_book.publish',
    'invoices.read', 'invoices.open', 'invoices.send',
    'receipts.read', 'receipts.record',
    'inventory.read', 'inventory.adjust', 'inventory.count',
    'exports.create', 'users.manage', 'organization.configure',
    'safety_policy.approve', 'audit.read',
  ],
  office: [
    'customers.read', 'customers.write',
    'service_requests.read', 'service_requests.update',
    'estimates.read', 'estimates.prepare', 'estimates.send',
    'jobs.read', 'jobs.write', 'jobs.schedule',
    'price_book.read',
    'invoices.read', 'invoices.open', 'invoices.send',
    'receipts.read', 'receipts.record',
    'inventory.read', 'inventory.adjust', 'inventory.count',
    'exports.create',
  ],
  technician: [
    'customers.read',
    'service_requests.read', 'service_requests.update',
    'estimates.read', 'estimates.prepare',
    'jobs.read', 'jobs.write',
    'price_book.read',
    'invoices.read',
    'inventory.read',
  ],
} as const satisfies Record<ApplicationRole, readonly Capability[]>;

export function capabilitiesForRole(role: ApplicationRole): ReadonlySet<Capability> {
  return new Set(ROLE_CAPABILITIES[role]);
}

export function hasCapability(
  capabilities: ReadonlySet<Capability>,
  capability: Capability,
): boolean {
  return capabilities.has(capability);
}

/**
 * What a customer access link authorizes. A purpose never names an action the
 * bearer may perform beyond its document; the decision route reconciles
 * `estimate.sign` with the customer's approve or decline choice.
 *
 * Mirrors the `document_type` + `purpose` columns of customer_access_grants:
 * the domain name and the storage split are different views of one set.
 */
export type CustomerAccessPurpose = 'estimate.sign' | 'estimate.view' | 'invoice.view';

export type OrganizationContext = {
  organizationId: string;
  verifiedHostname: string;
  actorId: string | null;
  membershipId: string | null;
  capabilities: ReadonlySet<Capability>;
  deploymentMode: DeploymentMode;
  requestId: string;
};

/**
 * Optional paid modules, sold individually.
 *
 * Four independent questions gate a module, and collapsing any two of them is
 * a defect rather than a simplification:
 *
 *   1. Is the subscription in good standing?   (subscription entitlement state)
 *   2. Has the tenant bought this module?      (feature entitlement, source='plan')
 *   3. Has the owner turned it on?             (versioned, approval-gated config)
 *   4. May this user do this?                  (role capability)
 *
 * Purchase is not activation, and activation is not permission.
 */
export type ModuleKey = 'inventory' | 'replenishment' | 'scheduling';

export type ModuleDefinition = {
  key: ModuleKey;
  name: string;
  description: string;
  /** Modules that must also be entitled for this one to function. */
  requires: readonly ModuleKey[];
  /** Capabilities this module introduces. */
  capabilities: readonly Capability[];
};

export const PLATFORM_MODULES = [
  {
    key: 'inventory',
    name: 'Inventory Control',
    description:
      'Track material stock as an append-only movement ledger, with cycle counts, '
      + 'variance reporting, and shrinkage write-offs.',
    requires: [],
    capabilities: ['inventory.read', 'inventory.adjust', 'inventory.count'],
  },
  {
    key: 'replenishment',
    name: 'Replenishment',
    description:
      'Reorder points and preferred suppliers per material item, producing a '
      + 'suggested order list. Suggests; does not order.',
    requires: ['inventory'],
    capabilities: [],
  },
  {
    key: 'scheduling',
    name: 'Appointment Scheduling',
    description:
      'Give jobs a scheduled window and an assigned technician, with customer '
      + 'confirmation through the transactional outbox.',
    requires: [],
    capabilities: ['jobs.schedule'],
  },
] as const satisfies readonly ModuleDefinition[];

export const MODULE_KEYS = PLATFORM_MODULES.map((module) => module.key);

export function isModuleKey(value: string): value is ModuleKey {
  return MODULE_KEYS.some((key) => key === value);
}

export function moduleDefinition(key: ModuleKey): ModuleDefinition {
  const found = PLATFORM_MODULES.find((module) => module.key === key);
  if (!found) throw new Error(`Unknown module: ${key}`);
  return found;
}

/**
 * Expands a purchased set to include prerequisites, so a tenant cannot end up
 * holding `replenishment` without `inventory`. Lives here, beside the catalog,
 * because the purchase path and the enforcement path must agree — a check in
 * the storefront UI alone would be bypassed by any other purchase route.
 */
export function resolveModulePrerequisites(
  purchased: Iterable<ModuleKey>,
): ReadonlySet<ModuleKey> {
  const resolved = new Set<ModuleKey>();
  const visit = (key: ModuleKey) => {
    if (resolved.has(key)) return;
    resolved.add(key);
    moduleDefinition(key).requires.forEach(visit);
  };
  for (const key of purchased) visit(key);
  return resolved;
}

/** Modules that are entitled but missing a prerequisite they cannot function without. */
export function unsatisfiedPrerequisites(
  entitled: ReadonlySet<ModuleKey>,
): ReadonlyMap<ModuleKey, readonly ModuleKey[]> {
  const gaps = new Map<ModuleKey, readonly ModuleKey[]>();
  for (const key of entitled) {
    const missing = moduleDefinition(key).requires.filter((need) => !entitled.has(need));
    if (missing.length) gaps.set(key, missing);
  }
  return gaps;
}

