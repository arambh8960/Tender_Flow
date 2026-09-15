import * as React from 'react';
import { useEffect, useState } from 'react';
import { Trash2, Plus, MapPin, AlertCircle } from 'lucide-react';

import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useWarehouses, useFinancialSettings } from '../../hooks/useOrganizationConfig';
import { useOrganization } from '../../contexts/OrganizationContext';
import { describeApiError } from '../../services/api/client';
import { Panel, Spinner, ErrorNote, EmptyState, buttonClass, ghostButtonClass, inputClass } from '../admin/AdminShell';

/**
 * Organisation settings: the configuration the agents actually read.
 *
 * Warehouses and financial defaults live here rather than under Admin because
 * they are organisation *identity*, not administration of it — and because
 * discovery and costing are wrong without them, so they need to be findable.
 */
export const OrganizationSettingsPage: React.FC = () => {
  const { can } = useOrganization();
  const canEdit = can('settings:write');

  const { profile, signingAuthorities, loading, saving, error, saveProfile, addSigningAuthority, removeSigningAuthority } =
    useCompanySettings();
  const warehouses = useWarehouses();
  const financial = useFinancialSettings();

  const [form, setForm] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      legalName: profile.legal_name ?? '',
      address: profile.address ?? '',
      city: (profile as Record<string, any>).city ?? '',
      state: (profile as Record<string, any>).state ?? '',
      pincode: (profile as Record<string, any>).pincode ?? '',
      country: (profile as Record<string, any>).country ?? 'India',
      gstin: profile.gstin ?? '',
      pan: profile.pan ?? '',
      domain: profile.domain ?? '',
      description: (profile as Record<string, any>).description ?? '',
      annualTurnoverCr: profile.annual_turnover_cr?.toString() ?? '',
      turnoverYear: profile.turnover_year ?? '',
      oemStatus: profile.oem_status ?? '',
    });
  }, [profile]);

  const [money, setMoney] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!financial.settings) return;
    const s = financial.settings;
    setMoney({
      defaultGstRate: String(s.default_gst_rate),
      brokeragePercent: String(s.brokerage_percent),
      targetMarginPercent: String(s.target_margin_percent),
      transportBufferPercent: String(s.transport_buffer_percent),
      defaultEmdPercent: String(s.default_emd_percent),
      defaultEpbgPercent: String(s.default_epbg_percent),
      ratePerKm: String(s.rate_per_km),
    });
  }, [financial.settings]);

  const [warehouseDraft, setWarehouseDraft] = useState({
    code: '', name: '', city: '', state: '', pincode: '', latitude: '', longitude: '',
  });
  const [authorityDraft, setAuthorityDraft] = useState({ name: '', designation: '', din: '' });

  const saveCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    setNotice(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value === '') continue;
        patch[key] = key === 'annualTurnoverCr' ? Number(value) : value;
      }
      await saveProfile(patch);
      setNotice('Company profile saved.');
    } catch (err) {
      setSaveError(describeApiError(err));
    }
  };

  const saveMoney = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    setNotice(null);
    try {
      await financial.save(Object.fromEntries(Object.entries(money).map(([k, v]) => [k, Number(v || 0)])));
      setNotice('Financial defaults saved.');
    } catch (err) {
      setSaveError(describeApiError(err));
    }
  };

  const addWarehouse = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    try {
      await warehouses.create({
        code: warehouseDraft.code.trim(),
        name: warehouseDraft.name.trim() || undefined,
        city: warehouseDraft.city.trim() || undefined,
        state: warehouseDraft.state.trim() || undefined,
        pincode: warehouseDraft.pincode.trim() || undefined,
        ...(warehouseDraft.latitude ? { latitude: Number(warehouseDraft.latitude) } : {}),
        ...(warehouseDraft.longitude ? { longitude: Number(warehouseDraft.longitude) } : {}),
      });
      setWarehouseDraft({ code: '', name: '', city: '', state: '', pincode: '', latitude: '', longitude: '' });
      setNotice('Warehouse added.');
    } catch {
      /* surfaced by the hook */
    }
  };

  if (loading && !profile) return <Spinner label="Loading organisation settings" />;

  const withoutCoordinates = warehouses.warehouses.filter(w => !w.hasCoordinates);

  return (
    <div className="space-y-6">
      {(error || saveError || warehouses.error || financial.error) && (
        <ErrorNote message={saveError ?? error ?? warehouses.error ?? financial.error ?? ''} />
      )}
      {notice && <p className="text-[11px] text-emerald-400">{notice}</p>}

      {!canEdit && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[11px] text-slate-400">
            You can view this configuration. Changing it requires the admin role.
          </p>
        </div>
      )}

      {/* ── General / legal / address ─────────────────────────────────── */}
      <Panel title="Company profile" subtitle="Identity used on bid documents and eligibility checks.">
        <form onSubmit={saveCompany} className="grid md:grid-cols-2 gap-4">
          {([
            ['legalName', 'Legal name', 'Registered entity name'],
            ['domain', 'Website / domain', 'acme.co.in'],
            ['description', 'Description', 'What your company supplies'],
            ['gstin', 'GSTIN', '22AAAAA0000A1Z5'],
            ['pan', 'PAN', 'AAAAA0000A'],
            ['annualTurnoverCr', 'Annual turnover (₹ Cr)', '0'],
            ['turnoverYear', 'Turnover year', '2024-25'],
            ['oemStatus', 'OEM status', 'OEM / Reseller'],
            ['address', 'Address', 'Street and locality'],
            ['city', 'City', 'Ludhiana'],
            ['state', 'State', 'Punjab'],
            ['pincode', 'PIN code', '141001'],
            ['country', 'Country', 'India'],
          ] as const).map(([key, label, placeholder]) => (
            <label key={key} className="block">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{label}</span>
              <input
                value={form[key] ?? ''}
                placeholder={placeholder}
                disabled={!canEdit}
                onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                className={`${inputClass} mt-2`}
              />
            </label>
          ))}

          {canEdit && (
            <div className="md:col-span-2">
              <button type="submit" disabled={saving} className={buttonClass}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          )}
        </form>
      </Panel>

      {/* ── Warehouses ────────────────────────────────────────────────── */}
      <Panel
        title="Warehouses"
        subtitle="Discovery measures delivery distance from these. Without coordinates it can only estimate."
      >
        {withoutCoordinates.length > 0 && (
          <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl px-4 py-3 mb-4 flex gap-3">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200 leading-relaxed">
              {withoutCoordinates.length} warehouse(s) have no coordinates, so tenders delivered near them fall back to
              your configured average distance rather than a measured route.
            </p>
          </div>
        )}

        {warehouses.loading && warehouses.warehouses.length === 0 ? (
          <Spinner label="Loading warehouses" />
        ) : warehouses.isEmpty ? (
          <EmptyState
            title="No warehouses yet"
            message="Add at least one so delivery distance and freight cost can be computed from a real origin."
          />
        ) : (
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
                  <th className="pb-3 pr-4">Code</th>
                  <th className="pb-3 pr-4">Location</th>
                  <th className="pb-3 pr-4">Coordinates</th>
                  {canEdit && <th className="pb-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {warehouses.warehouses.map(warehouse => (
                  <tr key={warehouse.id} className="border-t border-slate-800/60">
                    <td className="py-3 pr-4 text-[11px] text-slate-300 font-mono">{warehouse.code}</td>
                    <td className="py-3 pr-4 text-[12px] text-slate-200">
                      {[warehouse.city, warehouse.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {warehouse.hasCoordinates ? (
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {warehouse.latitude?.toFixed(3)}, {warehouse.longitude?.toFixed(3)}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                          Not set
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-3 text-right">
                        <button
                          onClick={() => {
                            if (window.confirm(`Remove warehouse ${warehouse.code}?`)) {
                              void warehouses.remove(warehouse.id).catch(() => undefined);
                            }
                          }}
                          className={ghostButtonClass}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canEdit && (
          <form onSubmit={addWarehouse} className="grid sm:grid-cols-4 gap-3">
            {([
              ['code', 'Code *'],
              ['name', 'Name'],
              ['city', 'City'],
              ['state', 'State'],
              ['pincode', 'PIN code'],
              ['latitude', 'Latitude'],
              ['longitude', 'Longitude'],
            ] as const).map(([key, label]) => (
              <input
                key={key}
                value={warehouseDraft[key]}
                onChange={e => setWarehouseDraft(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={label}
                required={key === 'code'}
                className={inputClass}
              />
            ))}
            <button type="submit" className={buttonClass}>
              <Plus className="w-3 h-3 inline mr-1" /> Add
            </button>
          </form>
        )}
      </Panel>

      {/* ── Financial defaults ────────────────────────────────────────── */}
      <Panel
        title="Financial defaults"
        subtitle="Fallbacks for costing. A tender's stated figure and a SKU's own rate always take precedence."
      >
        <form onSubmit={saveMoney} className="grid sm:grid-cols-3 gap-4">
          {([
            ['defaultGstRate', 'Default GST (%)'],
            ['brokeragePercent', 'Brokerage (%)'],
            ['targetMarginPercent', 'Target margin (%)'],
            ['transportBufferPercent', 'Transport buffer (%)'],
            ['defaultEmdPercent', 'Default EMD (%)'],
            ['defaultEpbgPercent', 'Default ePBG (%)'],
            ['ratePerKm', 'Freight rate (₹/km)'],
          ] as const).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{label}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={money[key] ?? ''}
                disabled={!canEdit}
                onChange={e => setMoney(prev => ({ ...prev, [key]: e.target.value }))}
                className={`${inputClass} mt-2`}
              />
            </label>
          ))}

          {canEdit && (
            <div className="sm:col-span-3">
              <button type="submit" disabled={financial.saving} className={buttonClass}>
                {financial.saving ? 'Saving…' : 'Save financial defaults'}
              </button>
            </div>
          )}
        </form>
      </Panel>

      {/* ── Signing authorities ───────────────────────────────────────── */}
      <Panel title="Signing authorities" subtitle="People authorised to sign a bid submission.">
        {signingAuthorities.length === 0 ? (
          <EmptyState title="None recorded" message="Add at least one authorised signatory before generating bid documents." />
        ) : (
          <ul className="space-y-2 mb-5">
            {signingAuthorities.map(authority => (
              <li key={authority.id} className="flex items-center justify-between gap-4 py-2 border-b border-slate-800/60 last:border-0">
                <div>
                  <p className="text-[12px] text-slate-200">{authority.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {authority.designation ?? 'Designation not recorded'}
                    {authority.din ? ` · DIN ${authority.din}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <button onClick={() => void removeSigningAuthority(authority.id)} className={ghostButtonClass}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (!authorityDraft.name.trim()) return;
              await addSigningAuthority({
                name: authorityDraft.name.trim(),
                designation: authorityDraft.designation.trim() || undefined,
                din: authorityDraft.din.trim() || undefined,
              });
              setAuthorityDraft({ name: '', designation: '', din: '' });
            }}
            className="grid sm:grid-cols-4 gap-3"
          >
            <input value={authorityDraft.name} onChange={e => setAuthorityDraft(p => ({ ...p, name: e.target.value }))} placeholder="Full name" className={inputClass} />
            <input value={authorityDraft.designation} onChange={e => setAuthorityDraft(p => ({ ...p, designation: e.target.value }))} placeholder="Designation" className={inputClass} />
            <input value={authorityDraft.din} onChange={e => setAuthorityDraft(p => ({ ...p, din: e.target.value }))} placeholder="DIN (optional)" className={inputClass} />
            <button type="submit" className={buttonClass}>Add</button>
          </form>
        )}
      </Panel>
    </div>
  );
};
