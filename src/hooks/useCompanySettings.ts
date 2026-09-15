import { useCallback, useEffect, useState } from 'react';
import { organizationApi, type CompanySnapshot } from '../services/api/organizationApi';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';

/**
 * Company profile, discovery settings and signing authorities.
 *
 * Replaces data/configData.ts, which hardcoded one company's GSTIN, PAN,
 * turnover and freight assumptions into the application source.
 */
export function useCompanySettings() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await organizationApi.getProfile(organizationId));
    } catch (err) {
      setError(describeApiError(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setSnapshot(null);
    void load();
  }, [load]);

  const saveProfile = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!organizationId) return;
      setSaving(true);
      try {
        await organizationApi.updateProfile(organizationId, patch);
        await load();
      } finally {
        setSaving(false);
      }
    },
    [organizationId, load]
  );

  const saveDiscoverySettings = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!organizationId) return;
      setSaving(true);
      try {
        await organizationApi.updateDiscoverySettings(organizationId, patch);
        await load();
      } finally {
        setSaving(false);
      }
    },
    [organizationId, load]
  );

  const addSigningAuthority = useCallback(
    async (authority: { name: string; designation?: string; din?: string }) => {
      if (!organizationId) return;
      await organizationApi.addSigningAuthority(organizationId, authority);
      await load();
    },
    [organizationId, load]
  );

  const removeSigningAuthority = useCallback(
    async (authorityId: string) => {
      if (!organizationId) return;
      await organizationApi.removeSigningAuthority(organizationId, authorityId);
      await load();
    },
    [organizationId, load]
  );

  return {
    snapshot,
    profile: snapshot?.profile ?? null,
    settings: snapshot?.settings ?? null,
    signingAuthorities: snapshot?.signingAuthorities ?? [],
    loading,
    saving,
    error,
    /** A brand-new workspace has a profile row but no details filled in. */
    needsProfileSetup: !loading && !snapshot?.profile?.gstin,
    reload: load,
    saveProfile,
    saveDiscoverySettings,
    addSigningAuthority,
    removeSigningAuthority,
  };
}
