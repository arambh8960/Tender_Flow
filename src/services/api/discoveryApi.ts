import { api } from './client';
import type { Tender, DiscoveryFilters, AdvancedSearchParams } from '../../../types';

export interface DiscoveryRunSummary {
  runId: string | null;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  portal: string;
  startedAt: string;
  completedAt: string;
  counts: {
    totalFound: number;
    totalNormalized: number;
    totalDuplicates: number;
    totalExpired: number;
    totalCandidates: number;
    totalQualified: number;
  };
  errors: { scope: string; message: string; kind: string }[];
}

export interface DiscoveryResponse {
  success: boolean;
  data: Tender[];
  summary?: DiscoveryRunSummary;
}

/**
 * Every discovery call is organisation-scoped. Inventory is NOT sent from the
 * browser any more — the server loads the organisation's own catalogue, so a
 * client cannot qualify a tender against a catalogue it does not own.
 */
export const discoveryApi = {
  search: (params: {
    organizationId: string;
    portal?: string;
    category: string;
    filters: Partial<DiscoveryFilters> & Record<string, unknown>;
  }) =>
    api.post<DiscoveryResponse>('/api/discover', {
      organizationId: params.organizationId,
      portal: params.portal ?? 'gem',
      category: params.category,
      filters: params.filters,
    }),

  advancedSearch: (params: { organizationId: string; filters: AdvancedSearchParams }) =>
    api.post<DiscoveryResponse>('/api/discover', {
      organizationId: params.organizationId,
      portal: 'gem',
      mode: 'advanced',
      filters: params.filters,
    }),

  listRuns: (organizationId: string) =>
    api.get<{ success: boolean; data: any[] }>(
      `/api/discovery/runs?organizationId=${encodeURIComponent(organizationId)}`
    ),

  listPortals: () => api.get<{ success: boolean; data: string[] }>('/api/discovery/portals'),
};
