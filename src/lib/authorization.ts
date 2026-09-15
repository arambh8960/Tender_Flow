import type { OrgRole } from '../../database.types';

/**
 * The one place role logic lives.
 *
 * Role strings must not be compared inline in components — a `role === 'admin'`
 * scattered through JSX is how permission drift starts. Components ask
 * `can(role, 'inventory:write')`, and this table is the only thing that
 * changes when the policy changes.
 *
 * It mirrors the database policies in supabase/migrations/0005_rls_policies.sql.
 * The database remains the enforcement boundary; this is for UI affordances
 * only. Hiding a button is not a security control.
 */

export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 50,
  admin: 40,
  manager: 30,
  member: 20,
  viewer: 10,
};

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
};

export const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'manager', 'member', 'viewer'];

export type Permission =
  | 'org:read'
  | 'org:update'
  | 'org:delete'
  | 'members:read'
  | 'members:manage'
  | 'modules:manage'
  | 'inventory:read'
  | 'inventory:write'
  | 'tenders:read'
  | 'tenders:write'
  | 'discovery:read'
  | 'discovery:run'
  | 'compliance:read'
  | 'compliance:write'
  | 'projects:read'
  | 'projects:write'
  | 'settings:read'
  | 'settings:write';

/** Minimum role required for each permission. */
const REQUIRED: Record<Permission, OrgRole> = {
  'org:read': 'viewer',
  'org:update': 'admin',
  'org:delete': 'owner',

  'members:read': 'viewer',
  'members:manage': 'admin',
  'modules:manage': 'admin',

  'inventory:read': 'viewer',
  'inventory:write': 'manager',

  'tenders:read': 'viewer',
  'tenders:write': 'manager',

  'discovery:read': 'viewer',
  'discovery:run': 'manager',

  'compliance:read': 'viewer',
  'compliance:write': 'manager',

  'projects:read': 'viewer',
  'projects:write': 'manager',

  'settings:read': 'viewer',
  'settings:write': 'admin',
};

export function roleAtLeast(role: OrgRole | null | undefined, minimum: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function can(role: OrgRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return roleAtLeast(role, REQUIRED[permission]);
}

/** Permission required, useful for explaining a denial in the UI. */
export function requiredRoleFor(permission: Permission): OrgRole {
  return REQUIRED[permission];
}

// ─── modules ──────────────────────────────────────────────────────────────
export const MODULE_KEYS = [
  'tender_discovery',
  'tender_analysis',
  'inventory',
  'procurement',
  'logistics',
  'compliance',
  'projects',
  'analytics',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  tender_discovery: 'Tender Discovery',
  tender_analysis: 'Tender Analysis',
  inventory: 'Inventory',
  procurement: 'Procurement',
  logistics: 'Logistics',
  compliance: 'Compliance',
  projects: 'Projects',
  analytics: 'Analytics',
};

export function isModuleEnabled(enabled: Set<string> | undefined, key: ModuleKey): boolean {
  if (!enabled) return false;
  return enabled.has(key);
}
