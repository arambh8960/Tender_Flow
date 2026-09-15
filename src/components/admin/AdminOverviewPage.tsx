import * as React from 'react';
import { useAdminOverview } from '../../hooks/useAdmin';
import { MetricCard, Panel, Spinner, ErrorNote, EmptyState } from './AdminShell';

/** Formats an audit action key as a sentence: "inventory.stock_adjusted". */
export function describeAction(action: string): string {
  const [domain, verb] = action.split('.');
  const readableVerb = (verb ?? '').replace(/_/g, ' ');
  return `${domain.replace(/_/g, ' ')} — ${readableVerb}`;
}

const currency = (value: number) =>
  `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const AdminOverviewPage: React.FC = () => {
  const { overview, loading, error, reload } = useAdminOverview();

  if (loading && !overview) return <Spinner label="Loading overview" />;

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Active users" value={overview?.metrics.activeUsers ?? 0} />
        <MetricCard label="Inventory SKUs" value={overview?.metrics.inventorySkus ?? 0} />
        <MetricCard
          label="Inventory value"
          value={currency(overview?.metrics.inventoryValue ?? 0)}
          hint="Available quantity × unit sales price"
        />
        <MetricCard label="Active tenders" value={overview?.metrics.activeTenders ?? 0} hint="Closing date in the future" />
        <MetricCard label="Discovery runs" value={overview?.metrics.discoveryRuns ?? 0} />
        <MetricCard label="RFPs processed" value={overview?.metrics.rfpsProcessed ?? 0} />
        <MetricCard
          label="High-risk RFPs"
          value={overview?.metrics.highRiskRfps ?? 0}
          tone={(overview?.metrics.highRiskRfps ?? 0) > 0 ? 'warning' : 'default'}
          hint="Latest 100 completed analyses"
        />
        <MetricCard
          label="Expiring documents"
          value={overview?.metrics.expiringDocuments ?? 0}
          tone={(overview?.metrics.expiringDocuments ?? 0) > 0 ? 'danger' : 'default'}
          hint="Expired or expiring within 30 days"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Recent discovery" subtitle="Including partial and failed runs">
          {overview?.recentDiscoveryRuns.length ? (
            <ul className="space-y-3">
              {overview.recentDiscoveryRuns.map(run => (
                <li key={run.id} className="flex items-start justify-between gap-4 border-b border-slate-800/60 pb-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[12px] text-slate-200 font-semibold uppercase tracking-wide">{run.portal}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {run.total_qualified} qualified of {run.total_found} found
                    </p>
                    {run.error_message && (
                      <p className="text-[10px] text-rose-400 mt-1 truncate max-w-sm">{run.error_message}</p>
                    )}
                  </div>
                  <span
                    className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg shrink-0 ${
                      run.status === 'completed'
                        ? 'bg-emerald-950/50 text-emerald-400'
                        : run.status === 'failed'
                          ? 'bg-rose-950/50 text-rose-400'
                          : 'bg-amber-950/50 text-amber-400'
                    }`}
                  >
                    {run.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No discovery yet" message="Configure discovery preferences and run a search to populate this panel." />
          )}
        </Panel>

        <Panel title="Recent RFPs" subtitle="Latest tender analyses">
          {overview?.recentRfps.length ? (
            <ul className="space-y-3">
              {overview.recentRfps.map(rfp => (
                <li key={rfp.id} className="flex items-start justify-between gap-4 border-b border-slate-800/60 pb-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[12px] text-slate-200 truncate">{rfp.title ?? 'Untitled tender'}</p>
                    <p className="text-[10px] text-slate-500 mt-1 truncate">{rfp.buyer ?? 'Buyer not identified'}</p>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                    {rfp.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No RFPs yet" message="Process a tender document to see its analysis history here." />
          )}
        </Panel>
      </div>

      <Panel
        title="Recent activity"
        subtitle="Persisted audit trail"
        action={
          <button onClick={() => void reload()} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white">
            Refresh
          </button>
        }
      >
        {overview?.recentActivity.length ? (
          <ul className="space-y-2">
            {overview.recentActivity.map(entry => (
              <li key={entry.id} className="flex items-center justify-between gap-4 text-[11px] py-1.5">
                <span className="text-slate-300">{describeAction(entry.action)}</span>
                <span className="text-slate-600 tabular-nums shrink-0">
                  {new Date(entry.created_at).toLocaleString('en-GB')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing recorded yet" message="Actions taken in this workspace will appear here as they happen." />
        )}
      </Panel>
    </div>
  );
};
