import * as React from 'react';
import { useEffect, useState } from 'react';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useDiscoveryRuns } from '../../hooks/useDiscovery';
import { describeApiError } from '../../services/api/client';
import { Panel, Spinner, ErrorNote, EmptyState, buttonClass, inputClass } from './AdminShell';

/**
 * Discovery configuration and history.
 *
 * The average-distance field is explicitly labelled an estimate: it is a
 * fallback used only when a tender's consignee location cannot be resolved,
 * never a substitute for the measured warehouse-to-consignee distance.
 */
export const AdminDiscoveryPage: React.FC = () => {
  const { settings, loading, saving, error, saveDiscoverySettings } = useCompanySettings();
  const { runs, loading: runsLoading, isEmpty, failedRuns } = useDiscoveryRuns();

  const [form, setForm] = useState({
    categories: '',
    manualAvgKms: '',
    manualRatePerKm: '',
    minMatchThreshold: '',
    allowEmd: true,
    deliveryType: '',
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      categories: settings.categories.join(', '),
      manualAvgKms: String(settings.manual_avg_kms),
      manualRatePerKm: String(settings.manual_rate_per_km),
      minMatchThreshold: String(settings.min_match_threshold),
      allowEmd: settings.allow_emd,
      deliveryType: settings.delivery_type,
    });
  }, [settings]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);
    try {
      await saveDiscoverySettings({
        categories: form.categories
          .split(',')
          .map(c => c.trim())
          .filter(Boolean),
        manualAvgKms: Number(form.manualAvgKms || 0),
        manualRatePerKm: Number(form.manualRatePerKm || 0),
        minMatchThreshold: Number(form.minMatchThreshold || 0),
        allowEmd: form.allowEmd,
        deliveryType: form.deliveryType || 'Pan India',
      });
      setSaved(true);
    } catch (err) {
      setSaveError(describeApiError(err));
    }
  };

  if (loading && !settings) return <Spinner label="Loading discovery settings" />;

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}
      {saveError && <ErrorNote message={saveError} />}

      <Panel title="Discovery preferences" subtitle="Applied to every search this workspace runs.">
        <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
          <label className="block md:col-span-2">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
              Target categories (comma separated)
            </span>
            <input
              value={form.categories}
              onChange={e => setForm({ ...form, categories: e.target.value })}
              placeholder="e.g. Cables, Switchgear, Fasteners"
              className={`${inputClass} mt-2`}
            />
          </label>

          <label className="block">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
              Fallback average distance (km)
            </span>
            <input
              type="number"
              min="0"
              value={form.manualAvgKms}
              onChange={e => setForm({ ...form, manualAvgKms: e.target.value })}
              className={`${inputClass} mt-2`}
            />
            <span className="text-[10px] text-slate-600 mt-1.5 block">
              Estimate only. Used when a tender's consignee location cannot be resolved; measured warehouse distance
              is preferred and labelled as such in the costing.
            </span>
          </label>

          <label className="block">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Freight rate (₹ per km)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.manualRatePerKm}
              onChange={e => setForm({ ...form, manualRatePerKm: e.target.value })}
              className={`${inputClass} mt-2`}
            />
          </label>

          <label className="block">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
              Minimum match threshold (%)
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={form.minMatchThreshold}
              onChange={e => setForm({ ...form, minMatchThreshold: e.target.value })}
              className={`${inputClass} mt-2`}
            />
            <span className="text-[10px] text-slate-600 mt-1.5 block">
              A tender scoring below this is reported as rejected, with its reasons, rather than hidden.
            </span>
          </label>

          <label className="block">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Delivery coverage</span>
            <input
              value={form.deliveryType}
              onChange={e => setForm({ ...form, deliveryType: e.target.value })}
              placeholder="Pan India"
              className={`${inputClass} mt-2`}
            />
          </label>

          <label className="flex items-center gap-3 md:col-span-2 pt-2">
            <input
              type="checkbox"
              checked={form.allowEmd}
              onChange={e => setForm({ ...form, allowEmd: e.target.checked })}
              className="w-4 h-4 accent-gold-500"
            />
            <span className="text-[11px] text-slate-300">
              Bid on tenders that require an EMD deposit
            </span>
          </label>

          <div className="md:col-span-2 flex items-center gap-4">
            <button type="submit" disabled={saving} className={buttonClass}>
              {saving ? 'Saving…' : 'Save preferences'}
            </button>
            {saved && <span className="text-[11px] text-emerald-400">Saved.</span>}
          </div>
        </form>
      </Panel>

      {failedRuns.length > 0 && (
        <Panel title="Failed and partial runs" subtitle="Runs that did not complete cleanly.">
          <ul className="space-y-2">
            {failedRuns.map(run => (
              <li key={run.id} className="py-2 border-b border-slate-800/60 last:border-0">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-slate-200 uppercase tracking-wide">{run.portal}</span>
                  <span className="text-[10px] text-slate-600 tabular-nums">
                    {new Date(run.created_at).toLocaleString('en-GB')}
                  </span>
                </div>
                <p className="text-[10px] text-rose-400 mt-1">{run.error_message ?? 'Completed with partial results.'}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Discovery history" subtitle={`${runs.length} run(s) recorded`}>
        {runsLoading && runs.length === 0 ? (
          <Spinner label="Loading history" />
        ) : isEmpty ? (
          <EmptyState
            title="No discovery runs yet"
            message="Set your target categories above, then run a search from the Discovery screen."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
                  <th className="pb-3 pr-4">Started</th>
                  <th className="pb-3 pr-4">Portal</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Found</th>
                  <th className="pb-3 pr-4">Duplicates</th>
                  <th className="pb-3">Qualified</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id} className="border-t border-slate-800/60">
                    <td className="py-3 pr-4 text-[11px] text-slate-400 tabular-nums">
                      {run.started_at ? new Date(run.started_at).toLocaleString('en-GB') : '—'}
                    </td>
                    <td className="py-3 pr-4 text-[11px] text-slate-300 uppercase">{run.portal}</td>
                    <td className="py-3 pr-4 text-[11px] text-slate-300">{run.status}</td>
                    <td className="py-3 pr-4 text-[11px] text-slate-400 tabular-nums">{run.total_found}</td>
                    <td className="py-3 pr-4 text-[11px] text-slate-400 tabular-nums">{run.total_duplicates}</td>
                    <td className="py-3 text-[11px] text-emerald-400 tabular-nums">{run.total_qualified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};
