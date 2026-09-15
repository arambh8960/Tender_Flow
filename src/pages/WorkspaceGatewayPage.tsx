import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Mail, ArrowRight, Check, Loader2, LogOut, Plus, X, AlertCircle } from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { useInvitations } from '../hooks/useInvitations';
import { ROLE_LABELS } from '../lib/authorization';
import { describeApiError } from '../services/api/client';

/**
 * The authenticated gateway: one screen that decides what the user needs next.
 *
 * Every branch renders something. The rule this page exists to enforce is that
 * a signed-in user is never shown a blank screen — not while loading, not when
 * the membership lookup fails, and not when they belong to nothing yet.
 *
 * A failed lookup is kept distinct from "no organisations". Treating an API
 * error as an empty result is how an existing customer gets shown a
 * create-your-company screen.
 */
export const WorkspaceGatewayPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const { memberships, activeOrganization, loading, loadFailed, error, refresh, setActiveOrganization } =
    useOrganization();
  const {
    invitations,
    loading: invitationsLoading,
    error: invitationsError,
    hasInvitations,
    accepting,
    accept,
    decline,
    reload: reloadInvitations,
  } = useInvitations();

  const [actionError, setActionError] = React.useState<string | null>(null);

  const primary =
    'px-5 py-3 rounded-xl bg-gold-500 text-slate-950 text-[10px] font-black uppercase tracking-widest ' +
    'hover:brightness-110 transition disabled:opacity-40 flex items-center justify-center gap-2';
  const ghost =
    'px-5 py-3 rounded-xl border border-slate-700 text-slate-300 text-[10px] font-black uppercase ' +
    'tracking-widest hover:bg-slate-800 transition disabled:opacity-40 flex items-center justify-center gap-2';

  const openWorkspace = (organizationId: string) => {
    setActiveOrganization(organizationId);
    navigate('/dashboard');
  };

  const onAccept = async (invitationId: string, organizationId: string) => {
    setActionError(null);
    try {
      await accept(invitationId);
      await refresh();
      setActiveOrganization(organizationId);
      navigate('/dashboard');
    } catch (err) {
      setActionError(describeApiError(err));
    }
  };

  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-[100dvh] w-full bg-slate-950 text-white font-sans flex flex-col">
      <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black uppercase italic tracking-tight">
            Tender<span className="text-gold-500">Flow</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1">
            {profile?.full_name ?? user?.email}
          </p>
        </div>
        <button
          onClick={() => void signOut()}
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition"
        >
          <LogOut className="w-3 h-3" /> Sign out
        </button>
      </div>

      <div className="flex-1 flex items-start justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-6">{children}</div>
      </div>
    </div>
  );

  /* ── E. loading ─────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <div className="w-10 h-10 border-2 border-slate-800 border-t-gold-500 rounded-full animate-spin" />
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">
            Loading your TenderFlow workspace
          </p>
        </div>
      </Shell>
    );
  }

  /* ── F. error ───────────────────────────────────────────────────────── */
  if (loadFailed) {
    return (
      <Shell>
        <div className="bg-rose-950/20 border border-rose-900/40 rounded-2xl p-8 text-center space-y-5">
          <h2 className="text-lg font-black uppercase tracking-tight">Could not load your workspace</h2>
          <p className="text-[12px] text-slate-400 leading-relaxed">
            {error ?? 'We could not reach the service that knows which organisations you belong to.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => void refresh()} className={primary}>
              Try again
            </button>
            <button onClick={() => void signOut()} className={ghost}>
              Sign out
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {actionError && (
        <div role="alert" className="bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3">
          <p className="text-[11px] text-rose-300">{actionError}</p>
        </div>
      )}

      {/* ── B. pending invitations, shown first when present ───────────── */}
      {hasInvitations && (
        <section className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">You have been invited</p>

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

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => void onAccept(invitation.id, invitation.organization_id)}
                  disabled={accepting === invitation.id}
                  className={primary}
                >
                  {accepting === invitation.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Accept
                </button>
                <button
                  onClick={() => void decline(invitation.id).catch(() => undefined)}
                  disabled={accepting === invitation.id}
                  className={ghost}
                  title="Decline this invitation"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* The invitation lookup is a convenience, never a gate on creation. */}
      {invitationsError && (
        <div className="bg-amber-950/20 border border-amber-900/40 rounded-2xl p-5 flex gap-3">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-[11px] text-amber-200 leading-relaxed">
              We could not check whether anyone has invited you. Everything below still works.
            </p>
            <button
              onClick={() => void reloadInvitations()}
              className="text-[10px] font-black uppercase tracking-widest text-amber-400 hover:text-amber-300"
            >
              Check again
            </button>
          </div>
        </div>
      )}

      {/* ── C/D. existing workspaces ───────────────────────────────────── */}
      {memberships.length > 0 ? (
        <section className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            {memberships.length === 1 ? 'Your workspace' : `Your workspaces (${memberships.length})`}
          </p>

          {memberships.map(({ organization, membership }) => (
            <div
              key={organization.id}
              className={`bg-slate-900/50 border rounded-2xl p-5 flex items-center justify-between gap-4 ${
                activeOrganization?.id === organization.id ? 'border-gold-500/40' : 'border-slate-800'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{organization.name}</p>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">
                  {ROLE_LABELS[membership.role as keyof typeof ROLE_LABELS] ?? membership.role}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openWorkspace(organization.id)} className={primary}>
                  Open <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setActiveOrganization(organization.id);
                    navigate('/organization/settings');
                  }}
                  className={ghost}
                >
                  Manage
                </button>
              </div>
            </div>
          ))}

          <button onClick={() => navigate('/organization/create')} className={`${ghost} w-full`}>
            <Plus className="w-3.5 h-3.5" /> Create another organisation
          </button>
        </section>
      ) : (
        /* ── A. no organisation ───────────────────────────────────────── */
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 mx-auto rounded-2xl border border-slate-800 bg-slate-900/60 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-gold-500" />
            </div>
            <h2 className="text-2xl font-black tracking-tight">Welcome to TenderFlow</h2>
            <p className="text-[12px] text-slate-400 max-w-md mx-auto leading-relaxed">
              Create your organisation, or join one you have been invited to. Everything in TenderFlow belongs to an
              organisation.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <button onClick={() => navigate('/organization/create')} className={primary}>
              <Building2 className="w-4 h-4" /> Create organisation
            </button>
            <button onClick={() => navigate('/organization/join')} className={ghost}>
              <Mail className="w-4 h-4" /> Join organisation
            </button>
          </div>

          {!hasInvitations && !invitationsError && !invitationsLoading && (
            <p className="text-[11px] text-slate-600 text-center leading-relaxed">
              No pending invitations for {user?.email}. If a colleague invited you, make sure they used this address.
            </p>
          )}
        </section>
      )}
    </Shell>
  );
};
