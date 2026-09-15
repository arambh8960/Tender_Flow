import * as React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Factory, Sliders, Mail, ArrowRight, ArrowLeft, Check, Loader2, LogOut, AlertCircle } from 'lucide-react';

import { useOrganization } from '../contexts/OrganizationContext';
import { useAuth } from '../contexts/AuthContext';
import { useInvitations } from '../hooks/useInvitations';
import { organizationAccountApi } from '../services/api/invitationApi';
import { describeApiError } from '../services/api/client';
import { organizationApi } from '../services/api/organizationApi';
import { ROLE_LABELS } from '../lib/authorization';

/**
 * Stage 2 of onboarding: get the user into an organisation.
 *
 * Two ways in, and the screen picks based on fact rather than asking the user
 * to know which applies: if someone has already invited them, joining is
 * offered first; otherwise they create a workspace and become its OWNER.
 *
 * Only the organisation name is required. Everything else can be filled in
 * later from Admin → Company — forcing a full company profile before anyone
 * can see the product is how onboarding gets abandoned.
 */

type Step = 'CHOOSE' | 'ORG' | 'PROFILE' | 'PREFERENCES';

const INDUSTRIES = [
  'Industrial Supply',
  'Electrical & Power',
  'Construction & Infrastructure',
  'IT & Electronics',
  'Medical & Laboratory',
  'Textiles & Apparel',
  'Automotive & Transport',
  'Chemicals',
  'Other',
];

const OEM_STATUSES = ['OEM', 'Authorised Dealer', 'Reseller', 'Trader', 'Service Provider'];

export const OrganizationOnboarding: React.FC = () => {
  const navigate = useNavigate();
  const { refresh, setActiveOrganization } = useOrganization();
  const { profile, user, signOut } = useAuth();
  const {
    invitations,
    loading: invitationsLoading,
    error: invitationsError,
    hasInvitations,
    accepting,
    accept,
    reload: reloadInvitations,
  } = useInvitations();

  const [step, setStep] = useState<Step>('CHOOSE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Stage: identity
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState(INDUSTRIES[0]);

  // Stage: company profile
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [address, setAddress] = useState('');
  const [domain, setDomain] = useState('');
  const [turnover, setTurnover] = useState('');
  const [turnoverYear, setTurnoverYear] = useState('');
  const [oemStatus, setOemStatus] = useState(OEM_STATUSES[0]);

  // Stage: procurement defaults
  const [avgKms, setAvgKms] = useState(400);
  const [ratePerKm, setRatePerKm] = useState(55);
  const [minMatch, setMinMatch] = useState(20);
  const [allowEmd, setAllowEmd] = useState(true);

  const input =
    'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white ' +
    'placeholder:text-slate-700 focus:outline-none focus:border-gold-500/60 transition-colors';

  const primary =
    'px-6 py-3 rounded-xl bg-gold-500 text-slate-950 text-[10px] font-black uppercase tracking-widest ' +
    'hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2';

  const ghost =
    'px-5 py-3 rounded-xl border border-slate-700 text-slate-300 text-[10px] font-black uppercase ' +
    'tracking-widest hover:bg-slate-800 transition disabled:opacity-40';

  /** Creates the organisation. The server makes the caller its OWNER. */
  const createOrganization = async () => {
    if (name.trim().length < 2) {
      setError('Enter your organisation name.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const organization = await organizationAccountApi.create({
        name: name.trim(),
        industry,
        legalName: legalName.trim() || undefined,
      });

      setOrgId(organization.id);
      await refresh();
      setActiveOrganization(organization.id);
      setStep('PROFILE');
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await organizationApi.updateProfile(orgId, {
        legalName: legalName.trim() || undefined,
        address: address.trim() || undefined,
        gstin: gstin.trim() || undefined,
        pan: pan.trim() || undefined,
        domain: domain.trim() || undefined,
        turnoverYear: turnoverYear.trim() || undefined,
        oemStatus,
        ...(turnover ? { annualTurnoverCr: Number(turnover) } : {}),
      });
      setStep('PREFERENCES');
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const savePreferences = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await organizationApi.updateDiscoverySettings(orgId, {
        manualAvgKms: avgKms,
        manualRatePerKm: ratePerKm,
        minMatchThreshold: minMatch,
        allowEmd,
      });
      // The workspace is reachable now; remaining setup happens in-product.
      await refresh();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const acceptInvitation = async (invitationId: string) => {
    setError(null);
    try {
      const membership = await accept(invitationId);
      await refresh();
      setActiveOrganization(membership.organization_id);
      navigate('/dashboard', { replace: true });
    } catch {
      /* surfaced by the hook */
    }
  };

  /**
   * Leaves onboarding for the workspace.
   *
   * This is the step that was missing: the component used to refresh
   * membership state and then stay exactly where it was, so a user who had
   * just created an organisation sat on /onboarding with no way forward
   * short of reloading the page by hand.
   */
  const enterWorkspace = async () => {
    setBusy(true);
    try {
      await refresh();
      navigate('/dashboard', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const steps: { key: Step; label: string; icon: React.ElementType }[] = [
    { key: 'ORG', label: 'Organisation', icon: Building2 },
    { key: 'PROFILE', label: 'Company', icon: Factory },
    { key: 'PREFERENCES', label: 'Procurement', icon: Sliders },
  ];
  const activeIndex = steps.findIndex(s => s.key === step);

  return (
    <div className="min-h-[100dvh] w-full bg-slate-950 text-white font-sans flex flex-col">
      {/* Header */}
      <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black uppercase italic tracking-tight">
            Tender<span className="text-gold-500">Flow</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1">
            {profile?.full_name ?? user?.email}
          </p>
        </div>
        <button onClick={() => void signOut()} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition">
          <LogOut className="w-3 h-3" /> Sign out
        </button>
      </div>

      <div className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-8">
          {error && (
            <div role="alert" className="p-3 bg-rose-950/30 border border-rose-900/50 rounded-xl text-rose-300 text-[12px]">
              {error}
            </div>
          )}

          {/* ── Choose: join an existing organisation, or create one ─────── */}
          {step === 'CHOOSE' && (
            <div className="space-y-8">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-black tracking-tight">Set up your workspace</h2>
                <p className="text-[12px] text-slate-400">
                  Your account is ready. Now join an organisation or create one.
                </p>
              </div>

              {invitationsError ? (
                // Checking for invitations is a convenience, not a
                // prerequisite. If that lookup fails the user must still be
                // able to create a workspace, so this reports the problem and
                // gets out of the way.
                <div className="bg-amber-950/20 border border-amber-900/40 rounded-2xl p-5 flex gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-[11px] text-amber-200 leading-relaxed">
                      We could not check whether anyone has invited you. You can still create your own organisation
                      below.
                    </p>
                    <button
                      onClick={() => void reloadInvitations()}
                      className="text-[10px] font-black uppercase tracking-widest text-amber-400 hover:text-amber-300"
                    >
                      Check again
                    </button>
                  </div>
                </div>
              ) : invitationsLoading ? (
                <div className="flex items-center justify-center gap-3 py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-gold-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Checking for invitations
                  </span>
                </div>
              ) : hasInvitations ? (
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    You have been invited
                  </p>

                  {invitations.map(invitation => (
                    <div
                      key={invitation.id}
                      className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{invitation.organization_name}</p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          {ROLE_LABELS[invitation.role] ?? invitation.role}
                          {invitation.invited_by_name ? ` · invited by ${invitation.invited_by_name}` : ''}
                        </p>
                        <p className="text-[10px] text-slate-600 mt-1">
                          Expires {new Date(invitation.expires_at).toLocaleDateString('en-GB')}
                        </p>
                      </div>
                      <button
                        onClick={() => void acceptInvitation(invitation.id)}
                        disabled={accepting === invitation.id}
                        className={primary}
                      >
                        {accepting === invitation.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Join
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 h-px bg-slate-800" />
                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">or</span>
                    <div className="flex-1 h-px bg-slate-800" />
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 flex gap-3">
                  <Mail className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    No pending invitations for {user?.email}. If a colleague invited you, make sure they used this
                    address — then reload.
                  </p>
                </div>
              )}

              <button onClick={() => setStep('ORG')} className={`${primary} w-full justify-center`}>
                Create a new organisation <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── Progress rail for the creation path ─────────────────────── */}
          {step !== 'CHOOSE' && (
            <div className="flex items-center justify-center gap-3">
              {steps.map((s, i) => (
                <React.Fragment key={s.key}>
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                        i <= activeIndex ? 'bg-gold-500 border-gold-500 text-slate-950' : 'border-slate-800 text-slate-600'
                      }`}
                    >
                      {i < activeIndex ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${i <= activeIndex ? 'text-white' : 'text-slate-600'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && <div className={`w-12 h-px ${i < activeIndex ? 'bg-gold-500' : 'bg-slate-800'}`} />}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* ── Stage: organisation identity ────────────────────────────── */}
          {step === 'ORG' && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-black tracking-tight">Create your organisation</h2>
                <p className="text-[11px] text-slate-500">
                  You become its owner. Everything else can wait until later.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Organisation name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Electrical Pvt Ltd" className={input} autoFocus />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Industry</label>
                <select value={industry} onChange={e => setIndustry(e.target.value)} className={input}>
                  {INDUSTRIES.map(i => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep('CHOOSE')} className={ghost}>
                  <ArrowLeft className="w-3 h-3 inline mr-1" /> Back
                </button>
                <button onClick={() => void createOrganization()} disabled={busy || name.trim().length < 2} className={primary}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── Stage: company profile ──────────────────────────────────── */}
          {step === 'PROFILE' && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-black tracking-tight">Company details</h2>
                <p className="text-[11px] text-slate-500">
                  Used on bid documents and by the financial agent. You can skip and add these later.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Legal name">
                  <input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="Registered entity name" className={input} />
                </Field>
                <Field label="Website / domain">
                  <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="acme.co.in" className={input} />
                </Field>
                <Field label="GSTIN">
                  <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" className={input} />
                </Field>
                <Field label="PAN">
                  <input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="AAAAA0000A" className={input} />
                </Field>
                <Field label="Annual turnover (₹ Cr)">
                  <input type="number" min="0" step="0.01" value={turnover} onChange={e => setTurnover(e.target.value)} placeholder="0" className={input} />
                </Field>
                <Field label="Turnover year">
                  <input value={turnoverYear} onChange={e => setTurnoverYear(e.target.value)} placeholder="2024-25" className={input} />
                </Field>
                <Field label="OEM status">
                  <select value={oemStatus} onChange={e => setOemStatus(e.target.value)} className={input}>
                    {OEM_STATUSES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Registered address" full>
                  <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, state, PIN" className={input} />
                </Field>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep('PREFERENCES')} className={ghost}>Skip for now</button>
                <button onClick={() => void saveProfile()} disabled={busy} className={primary}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── Stage: procurement defaults ─────────────────────────────── */}
          {step === 'PREFERENCES' && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-black tracking-tight">Procurement defaults</h2>
                <p className="text-[11px] text-slate-500">
                  Starting points for tender qualification. Adjust them any time in Admin → Discovery.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Fallback average distance (km)">
                  <input type="number" min="0" value={avgKms} onChange={e => setAvgKms(Number(e.target.value))} className={input} />
                  <span className="text-[10px] text-slate-600 mt-1 block">
                    An estimate, used only when a tender's consignee cannot be located.
                  </span>
                </Field>
                <Field label="Freight rate (₹ per km)">
                  <input type="number" min="0" step="0.01" value={ratePerKm} onChange={e => setRatePerKm(Number(e.target.value))} className={input} />
                </Field>
                <Field label="Minimum match threshold (%)">
                  <input type="number" min="0" max="100" value={minMatch} onChange={e => setMinMatch(Number(e.target.value))} className={input} />
                </Field>
                <Field label="EMD tenders">
                  <label className="flex items-center gap-3 pt-3">
                    <input type="checkbox" checked={allowEmd} onChange={e => setAllowEmd(e.target.checked)} className="w-4 h-4 accent-gold-500" />
                    <span className="text-[11px] text-slate-300">Bid on tenders requiring a deposit</span>
                  </label>
                </Field>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => void enterWorkspace()} className={ghost}>Skip for now</button>
                <button
                  onClick={async () => {
                    await savePreferences();
                    await enterWorkspace();
                  }}
                  disabled={busy}
                  className={primary}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Enter workspace <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; full?: boolean; children: React.ReactNode }> = ({ label, full, children }) => (
  <div className={`space-y-2 ${full ? 'sm:col-span-2' : ''}`}>
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
    {children}
  </div>
);
