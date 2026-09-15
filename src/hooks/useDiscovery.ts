import { useCallback, useEffect, useState } from 'react';
import { discoveryApi, type DiscoveryRunSummary } from '../services/api/discoveryApi';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';
import type { Tender, AdvancedSearchParams, DiscoveryFilters } from '../../types';

export interface DiscoveryRunRecord {
  id: string;
  portal: string;
  status: string;
  criteria: Record<string, unknown>;
  total_found: number;
  total_qualified: number;
  total_duplicates: number;
  total_expired: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  errors: { scope: string; message: string; kind?: string }[];
  created_at: string;
}

/**
 * Tender discovery for the active organisation.
 *
 * Results are cleared on tenant change so one company's qualified tenders
 * can never be read as another's, and a partial run is surfaced rather than
 * quietly presented as a complete one.
 */
export function useDiscovery() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [results, setResults] = useState<Tender[]>([]);
  const [summary, setSummary] = useState<DiscoveryRunSummary | null>(null);
  const [scanning, setScanning] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResults([]);
    setSummary(null);
    setHasSearched(false);
    setError(null);
  }, [organizationId]);

  const search = useCallback(
    async (params: { portal?: string; category: string; filters: Partial<DiscoveryFilters> & Record<string, unknown> }) => {
      if (!organizationId) return;
      setScanning(true);
      setError(null);
      try {
        const response = await discoveryApi.search({ organizationId, ...params });
        setResults(response.data);
        setSummary(response.summary ?? null);
        return response;
      } catch (err) {
        setError(describeApiError(err));
        setResults([]);
        // A failed run still has a summary with the portal errors in it.
        setSummary(((err as { body?: { summary?: DiscoveryRunSummary } })?.body?.summary) ?? null);
        throw err;
      } finally {
        setScanning(false);
        setHasSearched(true);
      }
    },
    [organizationId]
  );

  const advancedSearch = useCallback(
    async (filters: AdvancedSearchParams) => {
      if (!organizationId) return;
      setScanning(true);
      setError(null);
      try {
        const response = await discoveryApi.advancedSearch({ organizationId, filters });
        setResults(response.data);
        setSummary(response.summary ?? null);
        return response;
      } catch (err) {
        setError(describeApiError(err));
        setResults([]);
        throw err;
      } finally {
        setScanning(false);
        setHasSearched(true);
      }
    },
    [organizationId]
  );

  return {
    results,
    summary,
    scanning,
    hasSearched,
    error,
    qualified: results.filter(r => (r as Tender & { isQualified?: boolean }).isQualified !== false),
    search,
    advancedSearch,
    organizationId,
  };
}

/** Discovery history, including failed and partial runs. */
export function useDiscoveryRuns() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [runs, setRuns] = useState<DiscoveryRunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setRuns([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await discoveryApi.listRuns(organizationId);
      setRuns(response.data as DiscoveryRunRecord[]);
    } catch (err) {
      setError(describeApiError(err));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    runs,
    loading,
    error,
    isEmpty: !loading && !error && runs.length === 0,
    failedRuns: runs.filter(r => r.status === 'failed' || r.status === 'partial'),
    reload: load,
  };
}
