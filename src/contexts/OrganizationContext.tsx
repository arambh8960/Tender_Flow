import * as React from 'react';
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  OrganizationRepository,
  type MembershipWithOrg,
  type Organization,
  type OrganizationMember,
} from '../services/supabase/repositories/organizationRepository';
import { can, type Permission, type ModuleKey } from '../lib/authorization';
import { organizationAccountApi, type CreateOrganizationInput } from '../services/api/invitationApi';
import type { OrgRole } from '../../database.types';

const ACTIVE_ORG_STORAGE_KEY = 'tenderflow.activeOrganizationId';

interface OrganizationContextValue {
  loading: boolean;
  error: string | null;

  memberships: MembershipWithOrg[];
  activeOrganization: Organization | null;
  membership: OrganizationMember | null;
  role: OrgRole | null;

  enabledModules: Set<string>;
  isModuleEnabled: (key: ModuleKey) => boolean;
  can: (permission: Permission) => boolean;

  /**
   * True once auth is settled, the lookup SUCCEEDED, and the user genuinely
   * belongs to no organisation. A failed lookup must not read as "new user" —
   * that is how a transient API error turned into an onboarding screen for
   * someone who already had a workspace.
   */
  needsOnboarding: boolean;

  /**
   * Belongs to several organisations and has not chosen one this session, so
   * the workspace to open is genuinely ambiguous.
   */
  needsOrganizationChoice: boolean;

  /** The membership lookup failed. Distinct from "has no organisation". */
  loadFailed: boolean;

  setActiveOrganization: (organizationId: string) => void;
  createOrganization: (input: CreateOrganizationInput) => Promise<{ id: string; name: string; slug: string }>;
  refresh: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

export const OrganizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, initializing: authInitializing, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<MembershipWithOrg[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  // Separates "the lookup failed" from "the lookup found nothing".
  const [loadFailed, setLoadFailed] = useState(false);
  // True only when the user picked from the selector or switched explicitly.
  const [, setChoiceMade] = useState(false);
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());

  const readStoredOrgId = useCallback(() => {
    try {
      return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);

  const persistOrgId = useCallback((id: string | null) => {
    try {
      if (id) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, id);
      else localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      /* private browsing — the choice simply will not persist */
    }
  }, []);

  const loadMemberships = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      const rows = await OrganizationRepository.listMine();
      setMemberships(rows);

      // Resolve the active organisation: remembered choice if still valid,
      // otherwise the first membership.
      const stored = readStoredOrgId();
      const storedIsValid = stored && rows.some(r => r.organization.id === stored);

      // With exactly one membership there is nothing to choose, so open it.
      // With several and no remembered choice, leave it unset so the router
      // can offer a selector rather than silently guessing.
      const nextId = storedIsValid
        ? stored
        : rows.length === 1
          ? rows[0].organization.id
          : null;

      setActiveOrgId(nextId);
      if (storedIsValid) setChoiceMade(true);
      if (nextId !== stored) persistOrgId(nextId);
    } catch (err: any) {
      setError(err.message ?? 'Could not load your organisations.');
      setLoadFailed(true);
      setMemberships([]);
      setActiveOrgId(null);
    } finally {
      setLoading(false);
    }
  }, [readStoredOrgId, persistOrgId]);

  useEffect(() => {
    if (authInitializing) return;
    if (!isAuthenticated) {
      setMemberships([]);
      setActiveOrgId(null);
      setEnabledModules(new Set());
      setLoading(false);
      return;
    }
    void loadMemberships();
  }, [isAuthenticated, authInitializing, user?.id, loadMemberships]);

  // Module configuration is per organisation, so it reloads on every switch.
  useEffect(() => {
    if (!activeOrgId) {
      setEnabledModules(new Set());
      return;
    }
    let active = true;
    OrganizationRepository.listModules(activeOrgId)
      .then(mods => {
        if (!active) return;
        setEnabledModules(new Set(mods.filter(m => m.enabled).map(m => m.module_key)));
      })
      .catch(err => {
        console.error('[org] failed to load modules', err);
        if (active) setEnabledModules(new Set());
      });
    return () => {
      active = false;
    };
  }, [activeOrgId]);

  const current = useMemo(
    () => memberships.find(m => m.organization.id === activeOrgId) ?? null,
    [memberships, activeOrgId]
  );

  const role = (current?.membership.role as OrgRole | undefined) ?? null;

  const value = useMemo<OrganizationContextValue>(
    () => ({
      loading,
      error,
      memberships,
      activeOrganization: current?.organization ?? null,
      membership: current?.membership ?? null,
      role,
      enabledModules,
      isModuleEnabled: (key: ModuleKey) => enabledModules.has(key),
      can: (permission: Permission) => can(role, permission),
      // Note the `!loadFailed`: an error must never be mistaken for
      // "this user has no organisation".
      needsOnboarding:
        !authInitializing && isAuthenticated && !loading && !loadFailed && memberships.length === 0,

      needsOrganizationChoice:
        !authInitializing && isAuthenticated && !loading && !loadFailed && memberships.length > 1 && !activeOrgId,

      loadFailed,

      setActiveOrganization(organizationId: string) {
        if (!memberships.some(m => m.organization.id === organizationId)) {
          console.warn('[org] refusing to activate an organisation the user does not belong to');
          return;
        }
        setActiveOrgId(organizationId);
        setChoiceMade(true);
        persistOrgId(organizationId);
      },

      /**
       * Creates an organisation through the protected API rather than calling
       * the RPC from the browser.
       *
       * Both paths end at the same SECURITY DEFINER function, but routing
       * through the server means creation is validated, audited and rate
       * limited in one place — and there is only one implementation to keep
       * correct rather than two that can drift.
       */
      async createOrganization(input: CreateOrganizationInput) {
        const org = await organizationAccountApi.create(input);

        // Set the active organisation directly rather than relying on
        // loadMemberships to pick it: with two or more memberships that
        // function deliberately leaves the choice unset, which would drop the
        // user into the selector immediately after creating a workspace.
        await loadMemberships();
        setActiveOrgId(org.id);
        setChoiceMade(true);
        persistOrgId(org.id);
        return org;
      },

      refresh: loadMemberships,
    }),
    [
      loading, error, memberships, current, role, enabledModules, activeOrgId,
      loadFailed, authInitializing, isAuthenticated, persistOrgId, loadMemberships,
    ]
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
};

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error('useOrganization must be used inside <OrganizationProvider>');
  return ctx;
}

/**
 * The active organisation id, or throws. For data hooks that cannot
 * meaningfully run without a tenant — better a loud failure than a silent
 * cross-tenant query.
 */
export function useActiveOrganizationId(): string {
  const { activeOrganization } = useOrganization();
  if (!activeOrganization) throw new Error('No active organisation');
  return activeOrganization.id;
}
