import * as React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Package, ShieldCheck, Check, AlertCircle } from 'lucide-react';

import { useCompanySettings } from '../../hooks/useCompanySettings';
import { useSetupProgress } from '../../hooks/useOrganizationConfig';
import { useOrganization } from '../../contexts/OrganizationContext';
import { ROLE_LABELS } from '../../lib/authorization';
import { Panel, Spinner, ErrorNote } from '../admin/AdminShell';

/**
 * Read-only organisation overview, plus what still needs configuring.
 *
 * The setup checklist is computed on the server from real rows, so a green
 * tick means the agents genuinely have that input — not that somebody ticked
 * a box.
 */
export const OrganizationProfilePage: React.FC = () => {
  const { activeOrganization, role, memberships } = useOrganization();
  const { profile, loading, error } = useCompanySettings();
  const { progress, loading: progressLoading } = useSetupProgress();

  if (loading && !profile) return <Spinner label="Loading organisation" />;

  const extra = (profile ?? {}) as Record<string, unknown>;

  const rows: [string, string | null][] = [
    ['Legal name', profile?.legal_name ?? null],
    ['GSTIN', profile?.gstin ?? null],
    ['PAN', profile?.pan ?? null],
    ['Website', profile?.domain ?? null],
    [
      'Turnover',
      profile?.annual_turnover_cr
        ? `₹${profile.annual_turnover_cr} Cr (${profile.turnover_year ?? '—'})`
        : null,
    ],
    ['OEM status', profile?.oem_status ?? null],
    ['Address', profile?.address ?? null],
    [
      'Location',
      [extra.city, extra.state, extra.country].filter(Boolean).join(', ') || null,
    ],
  ];

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Panel
            title={activeOrganization?.name ?? 'Organisation'}
            subtitle={`You are ${role ? ROLE_LABELS[role] ?? role : 'a member'} · ${memberships.length} workspace(s) on this account`}
            action={
              <Link
                to="/organization/settings"
                className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
              >
                Edit
              </Link>
            }
          >
            <dl className="grid sm:grid-cols-2 gap-4">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{label}</dt>
                  <dd className={`text-[12px] mt-1.5 ${value ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                    {value || 'Not recorded'}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>

        <Panel title="Setup" subtitle={progress ? `${progress.completed} of ${progress.total} complete` : 'Checking'}>
          {progressLoading && !progress ? (
            <Spinner label="Checking setup" />
          ) : progress ? (
            <div className="space-y-4">
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gold-500 transition-all" style={{ width: `${progress.percentComplete}%` }} />
              </div>

              <ul className="space-y-2">
                {progress.steps.map(step => (
                  <li key={step.key}>
                    <Link to={step.href} className="flex items-start gap-3 py-1.5 group">
                      {step.complete ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p
                          className={`text-[11px] ${
                            step.complete ? 'text-slate-400' : 'text-slate-200 group-hover:text-white'
                          }`}
                        >
                          {step.label}
                        </p>
                        {!step.complete && <p className="text-[10px] text-slate-600 mt-0.5">{step.hint}</p>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Setup status is unavailable right now.</p>
          )}
        </Panel>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { icon: Package, label: 'Inventory items', value: progress?.counts.inventory ?? 0, href: '/inventory' },
          { icon: MapPin, label: 'Warehouses', value: progress?.counts.warehouses ?? 0, href: '/organization/settings' },
          { icon: ShieldCheck, label: 'Valid documents', value: progress?.counts.validDocuments ?? 0, href: '/vault' },
        ].map(({ icon: Icon, label, value, href }) => (
          <Link
            key={label}
            to={href}
            className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors"
          >
            <Icon className="w-4 h-4 text-gold-500" />
            <p className="text-2xl font-black text-white mt-3 tabular-nums">{value}</p>
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.25em] mt-1">{label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
};
