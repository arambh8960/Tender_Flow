import { useCallback, useEffect, useState } from 'react';
import {
  organizationConfigApi,
  type Warehouse,
  type FinancialSettings,
  type SetupProgress,
} from '../services/api/organizationConfigApi';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';

/** Warehouses for the active organisation — discovery measures haul from these. */
export function useWarehouses() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setWarehouses([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setWarehouses(await organizationConfigApi.listWarehouses(organizationId));
    } catch (err) {
      setError(describeApiError(err));
      setWarehouses([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setWarehouses([]);
    void load();
  }, [load]);

  const act = useCallback(
    async (operation: () => Promise<unknown>) => {
      setError(null);
      try {
        await operation();
        await load();
      } catch (err) {
        setError(describeApiError(err));
        throw err;
      }
    },
    [load]
  );

  return {
    warehouses,
    loading,
    error,
    isEmpty: !loading && !error && warehouses.length === 0,
    /** Only these can produce a measured distance rather than an estimate. */
    measurable: warehouses.filter(w => w.hasCoordinates),
    reload: load,
    create: (warehouse: Record<string, unknown>) =>
      act(() => organizationConfigApi.createWarehouse(organizationId as string, warehouse)),
    update: (id: string, patch: Record<string, unknown>) =>
      act(() => organizationConfigApi.updateWarehouse(organizationId as string, id, patch)),
    remove: (id: string) => act(() => organizationConfigApi.deleteWarehouse(organizationId as string, id)),
  };
}

/** Commercial defaults the financial agent reads. */
export function useFinancialSettings() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [settings, setSettings] = useState<FinancialSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      setSettings(await organizationConfigApi.getFinancialSettings(organizationId));
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!organizationId) return;
      setSaving(true);
      setError(null);
      try {
        await organizationConfigApi.updateFinancialSettings(organizationId, patch);
        await load();
      } catch (err) {
        setError(describeApiError(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [organizationId, load]
  );

  return { settings, loading, saving, error, reload: load, save };
}

/**
 * How much of the organisation is configured.
 *
 * Derived from real rows on the server, so a completed step always means the
 * agents genuinely have what they need — not that someone ticked a box.
 */
export function useSetupProgress() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setProgress(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setProgress(await organizationConfigApi.getSetupProgress(organizationId));
    } catch (err) {
      setError(describeApiError(err));
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    progress,
    loading,
    error,
    isComplete: progress ? progress.completed === progress.total : false,
    reload: load,
  };
}
