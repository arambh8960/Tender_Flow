import { useCallback, useEffect, useState } from 'react';
import { rfpApi, type RfpDetail, type RfpListItem } from '../services/api/rfpApi';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';

/**
 * RFP list and processing, backed by the database.
 *
 * Processing state is server-owned: a refresh, a second tab or a different
 * device all see the same status, because the status lives in tender_analyses
 * rather than in this component's state.
 */
export function useRfps() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [rfps, setRfps] = useState<RfpListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setRfps([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // The list view needs 25 rows, not every RFP the tenant has ever run.
      const result = await rfpApi.list(organizationId, { limit: 25 });
      setRfps(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(describeApiError(err));
      setRfps([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setRfps([]);
    void load();
  }, [load]);

  /**
   * Submits a document and waits for the pipeline.
   *
   * Returns the analysis id even on failure, so the caller can navigate to
   * the record and show why it failed rather than discarding it.
   */
  const submit = useCallback(
    async (params: { source: 'URL' | 'File' | 'Discovery'; content: string; fileName?: string; title?: string }) => {
      if (!organizationId) throw new Error('No active organisation');

      setProcessingId('pending');
      try {
        const result = await rfpApi.createAndProcess({ organizationId, ...params });
        await load();
        return result;
      } finally {
        setProcessingId(null);
      }
    },
    [organizationId, load]
  );

  const reprocess = useCallback(
    async (analysisId: string) => {
      if (!organizationId) throw new Error('No active organisation');
      setProcessingId(analysisId);
      try {
        const result = await rfpApi.reprocess(organizationId, analysisId);
        await load();
        return result;
      } finally {
        setProcessingId(null);
      }
    },
    [organizationId, load]
  );

  return {
    rfps,
    total,
    loading,
    error,
    isEmpty: !loading && !error && rfps.length === 0,
    processingId,
    reload: load,
    submit,
    reprocess,
    organizationId,
  };
}

/** One RFP with its agent outputs and run history. */
export function useRfp(analysisId: string | null) {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [rfp, setRfp] = useState<RfpDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !analysisId) {
      setRfp(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRfp(await rfpApi.get(organizationId, analysisId));
    } catch (err) {
      setError(describeApiError(err));
      setRfp(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, analysisId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rfp, loading, error, reload: load };
}
