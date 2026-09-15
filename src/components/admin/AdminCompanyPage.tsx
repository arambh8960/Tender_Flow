import * as React from 'react';
import { useEffect, useState } from 'react';
import { useCompanySettings } from '../../hooks/useCompanySettings';
import { describeApiError } from '../../services/api/client';
import { Panel, Spinner, ErrorNote, EmptyState, buttonClass, ghostButtonClass, inputClass } from './AdminShell';

/**
 * Company profile and signing authorities.
 *
 * Nothing here is prefilled from a bundled fixture: a new workspace shows
 * empty fields until its own details are entered.
 */

const FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'legalName', label: 'Legal name', placeholder: 'Registered entity name' },
  { key: 'address', label: 'Registered address', placeholder: 'Street, city, state, PIN' },
  { key: 'gstin', label: 'GSTIN', placeholder: '22AAAAA0000A1Z5' },
  { key: 'pan', label: 'PAN', placeholder: 'AAAAA0000A' },
  { key: 'domain', label: 'Industry / domain', placeholder: 'e.g. Industrial supply' },
  { key: 'annualTurnoverCr', label: 'Annual turnover (₹ Cr)', placeholder: '0', type: 'number' },
  { key: 'turnoverYear', label: 'Turnover year', placeholder: '2024-25' },
  { key: 'experienceYears', label: 'Years of experience', placeholder: '0', type: 'number' },
  { key: 'oemStatus', label: 'OEM status', placeholder: 'OEM / Reseller / Authorised dealer' },
];

export const AdminCompanyPage: React.FC = () => {
  const {
    profile,
    signingAuthorities,
    loading,
    saving,
    error,
    saveProfile,
    addSigningAuthority,
    removeSigningAuthority,
  } = useCompanySettings();

  const [form, setForm] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm({
      legalName: profile.legal_name ?? '',
      address: profile.address ?? '',
      gstin: profile.gstin ?? '',
      pan: profile.pan ?? '',
      domain: profile.domain ?? '',
      annualTurnoverCr: profile.annual_turnover_cr?.toString() ?? '',
      turnoverYear: profile.turnover_year ?? '',
      experienceYears: profile.experience_years?.toString() ?? '',
      oemStatus: profile.oem_status ?? '',
    });
  }, [profile]);

  const [authorityForm, setAuthorityForm] = useState({ name: '', designation: '', din: '' });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);
    try {
      // Numeric fields are sent as numbers; an empty string would fail
      // validation rather than meaning "leave unchanged".
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value === '') continue;
        patch[key] = key === 'annualTurnoverCr' || key === 'experienceYears' ? Number(value) : value;
      }
      await saveProfile(patch);
      setSaved(true);
    } catch (err) {
      setSaveError(describeApiError(err));
    }
  };

  const submitAuthority = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authorityForm.name.trim()) return;
    try {
      await addSigningAuthority({
        name: authorityForm.name.trim(),
        designation: authorityForm.designation.trim() || undefined,
        din: authorityForm.din.trim() || undefined,
      });
      setAuthorityForm({ name: '', designation: '', din: '' });
    } catch (err) {
      setSaveError(describeApiError(err));
    }
  };

  if (loading && !profile) return <Spinner label="Loading company profile" />;

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}
      {saveError && <ErrorNote message={saveError} />}

      <Panel title="Company profile" subtitle="Used by the bid documents and the financial agent.">
        <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
          {FIELDS.map(field => (
            <label key={field.key} className="block">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{field.label}</span>
              <input
                type={field.type ?? 'text'}
                value={form[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                className={`${inputClass} mt-2`}
              />
            </label>
          ))}

          <div className="md:col-span-2 flex items-center gap-4 pt-2">
            <button type="submit" disabled={saving} className={buttonClass}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            {saved && <span className="text-[11px] text-emerald-400">Saved.</span>}
          </div>
        </form>
      </Panel>

      <Panel title="Signing authorities" subtitle="People authorised to sign bid submissions.">
        <form onSubmit={submitAuthority} className="grid sm:grid-cols-4 gap-3 mb-5">
          <input
            value={authorityForm.name}
            onChange={e => setAuthorityForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Full name"
            className={inputClass}
          />
          <input
            value={authorityForm.designation}
            onChange={e => setAuthorityForm(prev => ({ ...prev, designation: e.target.value }))}
            placeholder="Designation"
            className={inputClass}
          />
          <input
            value={authorityForm.din}
            onChange={e => setAuthorityForm(prev => ({ ...prev, din: e.target.value }))}
            placeholder="DIN (optional)"
            className={inputClass}
          />
          <button type="submit" className={buttonClass}>
            Add
          </button>
        </form>

        {signingAuthorities.length === 0 ? (
          <EmptyState
            title="No signing authority recorded"
            message="Add at least one authorised signatory before generating bid documents."
          />
        ) : (
          <ul className="space-y-2">
            {signingAuthorities.map(authority => (
              <li key={authority.id} className="flex items-center justify-between gap-4 py-2 border-b border-slate-800/60 last:border-0">
                <div>
                  <p className="text-[12px] text-slate-200">{authority.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {authority.designation ?? 'Designation not recorded'}
                    {authority.din ? ` · DIN ${authority.din}` : ''}
                  </p>
                </div>
                <button onClick={() => void removeSigningAuthority(authority.id)} className={ghostButtonClass}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
};
