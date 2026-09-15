import * as React from 'react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AnalysisScreen } from '../components/AnalysisScreen';
import { ProcessingScreen } from '../components/ProcessingScreen';
import { FinalRecommendation } from '../components/FinalRecommendation';
import { EmptyWorkspaceNotice } from '../components/EmptyWorkspaceNotice';
import { BootSplash } from '../routes/guards';

import { useRfp, useRfps } from '../hooks/useRfps';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { useActivityLog } from '../contexts/ActivityLogContext';
import { toAppConfig, toRfp } from '../lib/adapters';
import { describeApiError } from '../services/api/client';

/**
 * RFP list and detail.
 *
 * Everything rendered here comes from the database, so reloading the page
 * mid-analysis shows the real current state — including a failure and the
 * reason for it — rather than an empty list.
 */

const STATUS_STYLES: Record<string, string> = {
  Complete: 'bg-emerald-950/50 text-emerald-400',
  Error: 'bg-rose-950/50 text-rose-400',
  Pending: 'bg-slate-800 text-slate-400',
  Extracting: 'bg-amber-950/50 text-amber-400',
  Parsing: 'bg-amber-950/50 text-amber-400',
  Processing: 'bg-amber-950/50 text-amber-400',
};

export const RfpListPage: React.FC = () => {
  const navigate = useNavigate();
  const { rfps, loading, error, isEmpty, total } = useRfps();

  if (loading && rfps.length === 0) return <BootSplash label="Loading tenders" />;

  if (isEmpty) {
    return (
      <EmptyWorkspaceNotice
        title="No tenders analysed yet"
        message="Submit a tender document or run discovery to find one. Every analysis is stored, so you can come back to it later."
        actionLabel="Run discovery"
        onAction={() => navigate('/discovery')}
        secondaryLabel="Back to dashboard"
        onSecondary={() => navigate('/dashboard')}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-hide">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white uppercase italic tracking-tight">
            Tenders<span className="text-gold-500">.</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1.5">
            {total} analysed
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3 mb-4">
          <p className="text-[11px] text-rose-300">{error}</p>
        </div>
      )}

      <div className="space-y-2">
        {rfps.map(rfp => (
          <button
            key={rfp.id}
            onClick={() => navigate(`/rfps/${rfp.id}`)}
            className="w-full text-left bg-slate-900/40 border border-slate-800 rounded-2xl px-5 py-4 hover:border-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] text-slate-100 truncate">
                  {rfp.title ?? rfp.file_name ?? 'Untitled tender'}
                </p>
                <p className="text-[10px] text-slate-500 mt-1.5 truncate">
                  {rfp.buyer ?? 'Buyer not identified'}
                  {rfp.bid_number ? ` · ${rfp.bid_number}` : ''}
                  {rfp.processing_seconds ? ` · ${rfp.processing_seconds}s` : ''}
                </p>
                {rfp.status === 'Error' && rfp.error_message && (
                  <p className="text-[10px] text-rose-400 mt-1.5 truncate">{rfp.error_message}</p>
                )}
              </div>
              <span
                className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg shrink-0 ${
                  STATUS_STYLES[rfp.status] ?? 'bg-slate-800 text-slate-400'
                }`}
              >
                {rfp.status}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

/** One RFP: processing view, analysis, or the final recommendation. */
export const RfpDetailPage: React.FC = () => {
  const { analysisId = null } = useParams();
  const navigate = useNavigate();

  const { rfp: detail, loading, error, reload } = useRfp(analysisId);
  const { reprocess } = useRfps();
  const { snapshot } = useCompanySettings();
  const { logs, addLog } = useActivityLog();

  const [stage, setStage] = useState<'auto' | 'analysis' | 'final'>('auto');
  const [analysisContext, setAnalysisContext] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);

  if (loading && !detail) return <BootSplash label="Loading tender" />;

  if (error || !detail) {
    return (
      <EmptyWorkspaceNotice
        title="Tender not found"
        message={error ?? 'This tender does not exist in your workspace, or you no longer have access to it.'}
        actionLabel="Back to tenders"
        onAction={() => navigate('/rfps')}
      />
    );
  }

  const rfp = toRfp(detail);
  const config = toAppConfig(snapshot);

  const retry = async () => {
    setRetrying(true);
    addLog('SYSTEM', `Re-running analysis for ${detail.id}…`);
    try {
      await reprocess(detail.id);
      await reload();
    } catch (err) {
      addLog('SYSTEM', `Re-run failed: ${describeApiError(err)}`);
    } finally {
      setRetrying(false);
    }
  };

  if (detail.status === 'Error') {
    return (
      <EmptyWorkspaceNotice
        title="Analysis failed"
        message={
          detail.error_message ??
          'The pipeline could not complete for this tender. The failure is recorded against the run, so it can be inspected in the admin audit log.'
        }
        actionLabel={retrying ? 'Retrying…' : 'Try again'}
        onAction={() => void retry()}
        secondaryLabel="Back to tenders"
        onSecondary={() => navigate('/rfps')}
      />
    );
  }

  // Still running: show the live processing view, driven by the persisted
  // status rather than a timer.
  if (detail.status !== 'Complete' && stage === 'auto') {
    return (
      <ProcessingScreen
        rfp={rfp}
        config={config}
        logs={logs}
        processingStartTime={detail.runs[0] ? new Date(detail.runs[0].started_at) : null}
        priorPhasesDuration={0}
        onViewResults={() => setStage('analysis')}
        onBack={() => navigate('/rfps')}
      />
    );
  }

  if (stage === 'final') {
    return (
      <FinalRecommendation
        rfp={rfp}
        analysisContext={analysisContext}
        onBack={() => setStage('analysis')}
        onCancel={() => navigate('/rfps')}
      />
    );
  }

  return (
    <AnalysisScreen
      rfp={rfp}
      config={config}
      onBack={() => navigate('/rfps')}
      onCancel={() => navigate('/rfps')}
      onProceed={data => {
        setAnalysisContext(data);
        setStage('final');
      }}
    />
  );
};
