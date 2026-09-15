import { api } from './client';

/**
 * Organisation configuration that the agents consume.
 *
 * Warehouses give discovery a real origin to measure from; financial settings
 * give the costing agent this tenant's own commercial assumptions instead of
 * a constant. Both are organisation-scoped server-side.
 */

export interface Warehouse {
  id: string;
  code: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  /** Whether a measured distance can be computed from here. */
  hasCoordinates: boolean;
}

export interface FinancialSettings {
  organization_id: string;
  default_gst_rate: number;
  brokerage_percent: number;
  target_margin_percent: number;
  transport_buffer_percent: number;
  default_emd_percent: number;
  default_epbg_percent: number;
  rate_per_km: number;
}

export interface SetupStep {
  key: string;
  label: string;
  complete: boolean;
  hint: string;
  href: string;
}

export interface SetupProgress {
  steps: SetupStep[];
  completed: number;
  total: number;
  percentComplete: number;
  counts: { inventory: number; warehouses: number; validDocuments: number };
}

const withOrg = (path: string, organizationId: string) =>
  `${path}?organizationId=${encodeURIComponent(organizationId)}`;

export const organizationConfigApi = {
  listWarehouses: (organizationId: string) =>
    api.get<{ data: Warehouse[] }>(withOrg('/api/organization/warehouses', organizationId)).then(r => r.data),

  createWarehouse: (organizationId: string, warehouse: Record<string, unknown>) =>
    api.post<{ data: { id: string; code: string } }>('/api/organization/warehouses', {
      organizationId,
      ...warehouse,
    }),

  updateWarehouse: (organizationId: string, warehouseId: string, patch: Record<string, unknown>) =>
    api.put<{ data: { id: string } }>(`/api/organization/warehouses/${encodeURIComponent(warehouseId)}`, {
      organizationId,
      ...patch,
    }),

  deleteWarehouse: (organizationId: string, warehouseId: string) =>
    api.delete<{ data: { id: string } }>(
      withOrg(`/api/organization/warehouses/${encodeURIComponent(warehouseId)}`, organizationId)
    ),

  getFinancialSettings: (organizationId: string) =>
    api
      .get<{ data: FinancialSettings | null }>(withOrg('/api/organization/financial-settings', organizationId))
      .then(r => r.data),

  updateFinancialSettings: (organizationId: string, patch: Record<string, unknown>) =>
    api.put<{ data: { updated: string[] } }>('/api/organization/financial-settings', {
      organizationId,
      ...patch,
    }),

  getSetupProgress: (organizationId: string) =>
    api.get<{ data: SetupProgress }>(withOrg('/api/organization/setup-progress', organizationId)).then(r => r.data),
};
