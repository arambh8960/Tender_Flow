import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { DiscoveryScreen } from '../components/DiscoveryScreen';
import { useDiscovery } from '../hooks/useDiscovery';
import { useInventory } from '../hooks/useInventory';
import { useRfps } from '../hooks/useRfps';
import { useActivityLog } from '../contexts/ActivityLogContext';
import { describeApiError } from '../services/api/client';
import { EmptyWorkspaceNotice } from '../components/EmptyWorkspaceNotice';
import type { DiscoveryFilters } from '../../types';

/**
 * Discovery screen wiring.
 *
 * Search results are whatever the server returned for THIS organisation.
 * There is no client-side scoring and no auto-triggered background search
 * against a hardcoded demo SKU.
 */
export const DiscoveryPage: React.FC = () => {
  const navigate = useNavigate();
  const { inventory, isEmpty: inventoryEmpty, loading: inventoryLoading } = useInventory();
  const { results, scanning, hasSearched, summary, search } = useDiscovery();
  const { submit } = useRfps();
  const { addLog } = useActivityLog();

  if (!inventoryLoading && inventoryEmpty) {
    return (
      <EmptyWorkspaceNotice
        title="Add inventory before running discovery"
        message="Tenders are qualified against your own catalogue — stock levels, specifications and warehouse locations. With no inventory there is nothing to match, so discovery would have nothing to say."
        actionLabel="Go to inventory"
        onAction={() => navigate('/inventory')}
      />
    );
  }

  return (
    <DiscoveryScreen
      inventory={inventory}
      results={results}
      isScanning={scanning}
      hasSearched={hasSearched}
      onOpenAdvanced={() => navigate('/discovery/advanced')}
      onSearch={async (portal: string, category: string, filters: DiscoveryFilters) => {
        addLog('MASTER_AGENT', `Searching ${portal} for "${category}"…`);
        try {
          // Spread into a plain object: the filter shape the screen produces
          // is narrower than the record the API accepts.
          const response = await search({ portal, category, filters: { ...filters } });
          addLog('MASTER_AGENT', `${response?.data.length ?? 0} tender(s) returned.`, response?.summary);

          // A partial run means some portal queries failed; saying so beats
          // presenting a short list as if it were the whole picture.
          if (response?.summary?.status === 'partial') {
            addLog(
              'SYSTEM',
              `Partial result — ${response.summary.errors.length} portal query(ies) failed.`,
              response.summary.errors
            );
          }
        } catch (err) {
          addLog('SYSTEM', `Discovery failed: ${describeApiError(err)}`, summary?.errors);
        }
      }}
      onProcessDiscovery={async (url: string) => {
        const bidId = url.replace(/\/$/, '').split('/').pop();
        addLog('SYSTEM', `Queuing tender ${bidId ?? url} for analysis…`);
        try {
          const result = await submit({ source: 'Discovery', content: url, fileName: `GeM_${bidId}` });
          navigate(`/rfps/${result.analysisId}`);
        } catch (err) {
          addLog('SYSTEM', `Could not process the tender: ${describeApiError(err)}`);
        }
      }}
    />
  );
};
