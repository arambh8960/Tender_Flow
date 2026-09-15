import * as React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FrontPage } from '../components/Frontpage';
import { StoreScreen } from '../components/StoreScreen';
import { ConfigScreen } from '../components/ConfigScreen';
import { VaultScreen } from '../components/VaultScreen';
import { LogScreen } from '../components/LogScreen';
import { AdvancedSearchScreen } from '../components/AdvancedSearchScreen';
import { VaultUnlock } from '../components/VaultUnlock';
import { EmptyWorkspaceNotice } from '../components/EmptyWorkspaceNotice';

import { useInventory } from '../hooks/useInventory';
import { useDiscovery } from '../hooks/useDiscovery';
import { useRfps } from '../hooks/useRfps';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useActivityLog } from '../contexts/ActivityLogContext';
import { useAuth } from '../contexts/AuthContext';
import { toAppConfig } from '../lib/adapters';
import { describeApiError } from '../services/api/client';
import type { AppConfig } from '../../types';

/** Dashboard. Discovery results shown here are whatever the last run found. */
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { results, scanning } = useDiscovery();
  const { submit } = useRfps();
  const { addLog } = useActivityLog();

  const startAnalysis = async (params: { source: 'URL' | 'File' | 'Discovery'; content: string; fileName?: string }) => {
    addLog('SYSTEM', `Ingesting ${params.source.toLowerCase()} source${params.fileName ? `: ${params.fileName}` : ''}…`);
    try {
      const result = await submit(params);
      navigate(`/rfps/${result.analysisId}`);
    } catch (err) {
      addLog('SYSTEM', `Ingestion failed: ${describeApiError(err)}`);
    }
  };

  return (
    <FrontPage
      tenders={results}
      isScanning={scanning}
      onNavigateToDiscovery={() => navigate('/discovery')}
      onProcessRfp={data => void startAnalysis(data)}
      onProcessDiscovery={url => {
        const bidId = url.replace(/\/$/, '').split('/').pop();
        void startAnalysis({ source: 'Discovery', content: url, fileName: `GeM_${bidId}` });
      }}
      // Refreshing means running discovery again, not a timer that pretends to.
      onRefreshDiscovery={() => navigate('/discovery')}
    />
  );
};

export const AdvancedSearchPage: React.FC = () => {
  const navigate = useNavigate();
  const { advancedSearch, scanning } = useDiscovery();
  const { addLog } = useActivityLog();

  return (
    <AdvancedSearchScreen
      isScanning={scanning}
      onBack={() => navigate('/discovery')}
      onRunAdvancedSearch={async params => {
        addLog('MASTER_AGENT', `Advanced search: ${params.activeTab}`);
        try {
          const response = await advancedSearch(params);
          addLog('MASTER_AGENT', `${response?.data.length ?? 0} bid(s) returned.`, response?.summary);
          navigate('/discovery');
        } catch (err) {
          addLog('SYSTEM', `Advanced search failed: ${describeApiError(err)}`);
        }
      }}
    />
  );
};

export const InventoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { inventory, loading, isEmpty, reload } = useInventory();

  if (!loading && isEmpty) {
    return (
      <EmptyWorkspaceNotice
        title="Your catalogue is empty"
        message="Add the products you supply — with stock levels, prices and specifications. Discovery and tender analysis both work from this catalogue."
        actionLabel="Add inventory"
        onAction={() => navigate('/admin/inventory')}
      />
    );
  }

  return (
    <StoreScreen
      inventory={inventory}
      // StoreScreen edits optimistically; a reload re-syncs with the server,
      // which is the only place stock is authoritative.
      setInventory={() => void reload()}
    />
  );
};

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { snapshot } = useCompanySettings();
  const { inventory } = useInventory();
  const { signOut } = useAuth();

  const config: AppConfig = toAppConfig(snapshot);

  return (
    <ConfigScreen
      config={config}
      // Company settings are saved through the admin screens, which is where
      // the write permission actually lives.
      setConfig={() => navigate('/admin/company')}
      inventory={inventory}
      onOpenVault={() => navigate('/vault')}
      onLogout={() => void signOut()}
      onChangePin={() => navigate('/settings/security')}
    />
  );
};

/**
 * Vault, behind the optional PIN unlock.
 *
 * The unlock is UI state for this session only; the documents themselves are
 * protected by RLS and signed URLs regardless of what this component does.
 */
export const VaultPage: React.FC = () => {
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(false);

  if (!unlocked) {
    return <VaultUnlock onUnlocked={() => setUnlocked(true)} onCancel={() => navigate('/settings')} />;
  }

  return <VaultScreen onBack={() => navigate('/settings')} />;
};

export const TerminalPage: React.FC = () => {
  const { logs } = useActivityLog();
  return <LogScreen logs={logs} />;
};
