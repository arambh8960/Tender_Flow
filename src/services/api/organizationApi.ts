import { api } from './client';
import type { SKU } from '../../../types';

/**
 * Company profile, settings, signing authorities and inventory.
 *
 * Every call names the organisation it acts on; the server verifies that the
 * caller is a member of it and derives its own authority from the session.
 * The shared configuration password this module used to send is gone.
 */

export interface OrganizationProfile {
  organization_id: string;
  legal_name: string | null;
  address: string | null;
  gstin: string | null;
  pan: string | null;
  domain: string | null;
  annual_turnover_cr: number | null;
  turnover_year: string | null;
  experience_years: number | null;
  oem_status: string | null;
}

export interface DiscoverySettings {
  organization_id: string;
  default_portals: string[];
  categories: string[];
  manual_avg_kms: number;
  manual_rate_per_km: number;
  allow_emd: boolean;
  min_match_threshold: number;
  delivery_type: string;
}

export interface SigningAuthority {
  id: string;
  name: string;
  designation: string | null;
  din: string | null;
}

export interface CompanySnapshot {
  organization: { id: string; name: string; slug: string; industry: string | null } | null;
  profile: OrganizationProfile | null;
  settings: DiscoverySettings | null;
  signingAuthorities: SigningAuthority[];
  role: string;
}

export interface ComplianceSnapshot {
  profile: OrganizationProfile | null;
  certificates: {
    id: string;
    cert_name: string;
    category: string | null;
    expiry_date: string | null;
    is_valid: boolean;
    isCurrentlyValid: boolean;
  }[];
}

const withOrg = (path: string, organizationId: string, extra = '') =>
  `${path}?organizationId=${encodeURIComponent(organizationId)}${extra}`;

export const organizationApi = {
  getProfile: (organizationId: string) =>
    api.get<{ data: CompanySnapshot }>(withOrg('/api/organization/profile', organizationId)).then(r => r.data),

  updateProfile: (organizationId: string, patch: Partial<Omit<OrganizationProfile, 'organization_id'>> & Record<string, unknown>) =>
    api.put<{ data: { updated: string[] } }>('/api/organization/profile', { organizationId, ...patch }),

  updateDiscoverySettings: (organizationId: string, patch: Record<string, unknown>) =>
    api.put<{ data: { updated: string[] } }>('/api/organization/discovery-settings', { organizationId, ...patch }),

  addSigningAuthority: (organizationId: string, authority: { name: string; designation?: string; din?: string }) =>
    api.post<{ data: { id: string } }>('/api/organization/signing-authorities', { organizationId, ...authority }),

  removeSigningAuthority: (organizationId: string, authorityId: string) =>
    api.delete<{ data: { id: string } }>(
      withOrg(`/api/organization/signing-authorities/${encodeURIComponent(authorityId)}`, organizationId)
    ),

  getComplianceSnapshot: (organizationId: string) =>
    api.get<{ data: ComplianceSnapshot }>(withOrg('/api/compliance-check', organizationId)).then(r => r.data),
};

export interface InventoryQuery {
  search?: string;
  category?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

export const inventoryApi = {
  list: (organizationId: string, query: InventoryQuery = {}) => {
    const params = new URLSearchParams({ organizationId });
    if (query.search) params.set('search', query.search);
    if (query.category) params.set('category', query.category);
    if (query.includeInactive) params.set('includeInactive', 'true');
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));

    return api.get<{ data: SKU[]; total: number }>(`/api/inventory?${params.toString()}`);
  },

  create: (organizationId: string, item: Record<string, unknown>) =>
    api.post<{ data: { id: string; sku_id: string } }>('/api/inventory', { organizationId, ...item }),

  update: (organizationId: string, skuId: string, patch: Record<string, unknown>) =>
    api.put<{ data: { skuId: string; updated: string[] } }>(`/api/inventory/${encodeURIComponent(skuId)}`, {
      organizationId,
      ...patch,
    }),

  archive: (organizationId: string, skuId: string) =>
    api.delete<{ data: { skuId: string } }>(withOrg(`/api/inventory/${encodeURIComponent(skuId)}`, organizationId)),

  /** Absolute quantity. The server rejects anything that would go negative. */
  setStock: (organizationId: string, skuId: string, quantity: number) =>
    api.post<{ data: { skuId: string; availableQuantity: number } }>('/api/inventory/stock', {
      organizationId,
      skuId,
      quantity,
    }),

  adjustStock: (organizationId: string, skuId: string, delta: number) =>
    api.post<{ data: { skuId: string; availableQuantity: number } }>('/api/inventory/stock', {
      organizationId,
      skuId,
      delta,
    }),
};
