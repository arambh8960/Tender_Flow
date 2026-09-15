import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, FileText, Package, ShieldCheck, AlertTriangle, Check, ArrowRight, Loader2 } from 'lucide-react';

import { useOrganization } from '../contexts/OrganizationContext';
import { useSetupProgress } from '../hooks/useOrganizationConfig';
import { useInventory } from '../hooks/useInventory';
import { useRfps } from '../hooks/useRfps';
import { useVault } from '../hooks/useVault';
import { useDiscoveryRuns } from '../hooks/useDiscovery';
import { ROLE_LABELS } from '../lib/authorization';

/**
 * The authenticated home screen.
 *
 * Every number here is derived from this organisation's own rows. A brand-new
 * workspace therefore shows zeroes and a prompt to act, not invented activity
 * — a dashboard that displays plausible figures for an empty company teaches
 * the user to distrust all of them.
 */
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeOrganization, role } = useOrganization();

  const { progress, loading: progressLoading, isComplete } = useSetupProgress();
  const { inventory, total: inventoryTotal, loading: inventoryLoading } = useInventory();
  const { rfps, total: rfpTotal, loading: rfpsLoading } = useRfps();
  const { documents, expiringSoon, expired, loading: vaultLoading } = useVault();
  const { runs, loading: runsLoading } = useDiscoveryRuns();

  const latestRun = runs[0] ?? null;
  const qualifiedTotal = runs.reduce((sum, run) => sum + (run.total_qualified ?? 0), 0);

  const processing = rfps.filter(r => !['Complete', 'Error'].includes(r.status)).length;
  const completed = rfps.filter(r => r.status === 'Complete').length;
  const failed = rfps.filter(r => r.status === 'Error').length;

  const inventoryValue = inventory.reduce(
    (sum, sku) => sum + (sku.availableQuantity || 0) * (sku.unitSalesPrice || 0),
    0
  );

  const anyLoading = progressLoading || inventoryLoading || rfpsLoading || vaultLoading || runsLoading;

  return (
    <div className="h-full overflow-y-auto scrollbar-hide space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white uppercase italic tracking-tight">
            {activeOrganization?.name ?? 'Workspace'}
            <span className="text-gold-500">.</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1.5">
            {role ? ROLE_LABELS[role] ?? role : 'Member'}
            {anyLoading && ' · loading'}
          </p>
        </div>

        <Link
          to="/discovery"
          className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-gold-500 text-slate-950 hover:brightness-110 transition flex items-center gap-2"
        >
          <Search className="w-3.5 h-3.5" /> Find tenders
        </Link>
      </div>

      {/* Setup progress — only while something is outstanding. */}
      {progress && !isComplete && (
        <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-[0.2em]">Finish setting up</h2>
              <p className="text-[11px] text-slate-500 mt-1">
                {progress.completed} of {progress.total} complete — you can use TenderFlow meanwhile.
              </p>
            </div>
            <span className="text-2xl font-black text-gold-500 tabular-nums">{progress.percentComplete}%</span>
          </div>

          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gold-500 transition-all" style={{ width: `${progress.percentComplete}%` }} />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {progress.steps.map(step => (
              <Link
                key={step.key}
                to={step.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] transition ${
                  step.complete
                    ? 'border-slate-800 text-slate-500'
                    : 'border-slate-700 text-slate-200 hover:border-gold-500/50'
                }`}
              >
                {step.complete ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                )}
                {step.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Headline metrics, all derived */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Inventory SKUs" value={inventoryTotal} hint={`₹${Math.round(inventoryValue).toLocaleString('en-IN')} at list price`} />
        <Metric label="Qualified tenders" value={qualifiedTotal} hint={`${runs.length} discovery run(s)`} />
        <Metric label="RFPs analysed" value={completed} hint={processing > 0 ? `${processing} in progress` : `${rfpTotal} total`} />
        <Metric
          label="Documents expiring"
          value={expiringSoon.length + expired.length}
          tone={expired.length > 0 ? 'danger' : expiringSoon.length > 0 ? 'warning' : 'default'}
          hint={`${documents.length} in the vault`}
        />
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Discovery */}
        <Card
          title="Discovery"
          action={<Link to="/discovery" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white">Open</Link>}
        >
          {runsLoading && runs.length === 0 ? (
            <Loading />
          ) : runs.length === 0 ? (
            <Empty
              icon={Search}
              title="No discovery runs yet"
              body="Set your target categories and freight rate, then search for tenders that match your catalogue."
              actionLabel="Configure discovery"
              onAction={() => navigate('/admin/discovery')}
            />
          ) : (
            <div className="space-y-3">
              <Row label="Latest run" value={latestRun?.portal?.toUpperCase() ?? '—'} />
              <Row
                label="Status"
                value={latestRun?.status ?? '—'}
                tone={latestRun?.status === 'failed' ? 'danger' : latestRun?.status === 'partial' ? 'warning' : 'default'}
              />
              <Row label="Qualified" value={String(latestRun?.total_qualified ?? 0)} />
              <Row label="Found" value={String(latestRun?.total_found ?? 0)} />
              {latestRun?.error_message && (
                <p className="text-[10px] text-rose-400 leading-relaxed">{latestRun.error_message}</p>
              )}
            </div>
          )}
        </Card>

        {/* RFPs */}
        <Card
          title="Tender analysis"
          action={<Link to="/rfps" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white">Open</Link>}
        >
          {rfpsLoading && rfps.length === 0 ? (
            <Loading />
          ) : rfps.length === 0 ? (
            <Empty
              icon={FileText}
              title="No RFPs processed yet"
              body="Submit a tender document, or send one through from a discovery result."
              actionLabel="Find tenders"
              onAction={() => navigate('/discovery')}
            />
          ) : (
            <div className="space-y-3">
              <Row label="Completed" value={String(completed)} />
              <Row label="In progress" value={String(processing)} />
              <Row label="Failed" value={String(failed)} tone={failed > 0 ? 'danger' : 'default'} />

              <ul className="pt-2 space-y-2 border-t border-slate-800/60">
                {rfps.slice(0, 3).map(rfp => (
                  <li key={rfp.id}>
                    <Link to={`/rfps/${rfp.id}`} className="flex items-center justify-between gap-3 group">
                      <span className="text-[11px] text-slate-300 truncate group-hover:text-white">
                        {rfp.title ?? rfp.file_name ?? 'Untitled tender'}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 shrink-0">
                        {rfp.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Inventory */}
        <Card
          title="Inventory"
          action={<Link to="/inventory" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white">Open</Link>}
        >
          {inventoryLoading && inventory.length === 0 ? (
            <Loading />
          ) : inventory.length === 0 ? (
            <Empty
              icon={Package}
              title="Add your first products"
              body="Tenders are matched against your catalogue. Without it, discovery has nothing to qualify."
              actionLabel="Add inventory"
              onAction={() => navigate('/admin/inventory')}
            />
          ) : (
            <div className="space-y-3">
              <Row label="Active SKUs" value={String(inventoryTotal)} />
              <Row label="Out of stock" value={String(inventory.filter(s => s.availableQuantity === 0).length)} />
              <Row label="List value" value={`₹${Math.round(inventoryValue).toLocaleString('en-IN')}`} />
            </div>
          )}
        </Card>

        {/* Vault */}
        <Card
          title="Compliance vault"
          action={<Link to="/vault" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white">Open</Link>}
        >
          {vaultLoading && documents.length === 0 ? (
            <Loading />
          ) : documents.length === 0 ? (
            <Empty
              icon={ShieldCheck}
              title="Set up your compliance vault"
              body="Upload registrations and certificates. Qualification checks them by expiry date."
              actionLabel="Upload documents"
              onAction={() => navigate('/admin/compliance')}
            />
          ) : (
            <div className="space-y-3">
              <Row label="Documents" value={String(documents.length)} />
              <Row label="Expiring within 30 days" value={String(expiringSoon.length)} tone={expiringSoon.length > 0 ? 'warning' : 'default'} />
              <Row label="Expired" value={String(expired.length)} tone={expired.length > 0 ? 'danger' : 'default'} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number | string; hint?: string; tone?: 'default' | 'warning' | 'danger' }> = ({
  label,
  value,
  hint,
  tone = 'default',
}) => (
  <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
    <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.25em]">{label}</p>
    <p
      className={`text-3xl font-black mt-3 tabular-nums ${
        tone === 'danger' ? 'text-rose-400' : tone === 'warning' ? 'text-amber-400' : 'text-white'
      }`}
    >
      {value}
    </p>
    {hint && <p className="text-[10px] text-slate-600 mt-2">{hint}</p>}
  </div>
);

const Card: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  action,
  children,
}) => (
  <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-sm font-black text-white uppercase tracking-[0.2em]">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const Row: React.FC<{ label: string; value: string; tone?: 'default' | 'warning' | 'danger' }> = ({
  label,
  value,
  tone = 'default',
}) => (
  <div className="flex items-center justify-between">
    <span className="text-[11px] text-slate-500">{label}</span>
    <span
      className={`text-[12px] font-bold tabular-nums ${
        tone === 'danger' ? 'text-rose-400' : tone === 'warning' ? 'text-amber-400' : 'text-slate-200'
      }`}
    >
      {value}
    </span>
  </div>
);

const Loading: React.FC = () => (
  <div className="flex items-center gap-3 py-6">
    <Loader2 className="w-4 h-4 animate-spin text-gold-500" />
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Loading</span>
  </div>
);

/** An empty section says what to do, never a fabricated statistic. */
const Empty: React.FC<{
  icon: React.ElementType;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ icon: Icon, title, body, actionLabel, onAction }) => (
  <div className="text-center py-6 space-y-3">
    <Icon className="w-6 h-6 text-slate-700 mx-auto" />
    <div className="space-y-1.5">
      <p className="text-[12px] font-bold text-slate-300">{title}</p>
      <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">{body}</p>
    </div>
    <button
      onClick={onAction}
      className="text-[10px] font-black uppercase tracking-widest text-gold-500 hover:text-gold-400 inline-flex items-center gap-1"
    >
      {actionLabel} <ArrowRight className="w-3 h-3" />
    </button>
  </div>
);
