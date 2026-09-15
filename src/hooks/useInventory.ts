import { useCallback, useEffect, useState } from 'react';
import { inventoryApi } from '../services/api';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';
import type { SKU } from '../../types';

/**
 * Inventory for the ACTIVE organisation, through the API.
 *
 * Replaces the module-level import of data/storeData.ts. The list is cleared
 * and refetched whenever the tenant changes and never merged, because this
 * array is what the agents score tenders against — two tenants' stock in one
 * array would be a correctness bug, not just a display one.
 */
export function useInventory(options: { search?: string; category?: string; includeInactive?: boolean } = {}) {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [inventory, setInventory] = useState<SKU[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { search, category, includeInactive } = options;

  const load = useCallback(async () => {
    if (!organizationId) {
      setInventory([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await inventoryApi.list(organizationId, { search, category, includeInactive, limit: 500 });
      setInventory(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(describeApiError(err));
      setInventory([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, search, category, includeInactive]);

  useEffect(() => {
    setInventory([]);
    void load();
  }, [load]);

  const setStock = useCallback(
    async (skuId: string, quantity: number) => {
      if (!organizationId) return;
      const result = await inventoryApi.setStock(organizationId, skuId, quantity);
      // Trust the server's returned quantity rather than the optimistic one:
      // it is the value that passed the non-negative check.
      setInventory(prev =>
        prev.map(sku => (sku.skuId === skuId ? { ...sku, availableQuantity: result.data.availableQuantity } : sku))
      );
    },
    [organizationId]
  );

  const create = useCallback(
    async (item: Record<string, unknown>) => {
      if (!organizationId) return;
      await inventoryApi.create(organizationId, item);
      await load();
    },
    [organizationId, load]
  );

  const update = useCallback(
    async (skuId: string, patch: Record<string, unknown>) => {
      if (!organizationId) return;
      await inventoryApi.update(organizationId, skuId, patch);
      await load();
    },
    [organizationId, load]
  );

  const archive = useCallback(
    async (skuId: string) => {
      if (!organizationId) return;
      await inventoryApi.archive(organizationId, skuId);
      await load();
    },
    [organizationId, load]
  );

  return {
    inventory,
    total,
    loading,
    error,
    /** True once a load has finished and the organisation genuinely has none. */
    isEmpty: !loading && !error && inventory.length === 0,
    reload: load,
    setStock,
    create,
    update,
    archive,
    organizationId,
  };
}
