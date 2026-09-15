import * as React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Mail, Check, X, Loader2, ArrowLeft, AlertCircle, Building2 } from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { useInvitations } from '../hooks/useInvitations';
import { invitationApi, type InvitationByToken } from '../services/api/invitationApi';
import { describeApiError } from '../services/api/client';
import { ROLE_LABELS } from '../lib/authorization';

/**
 * Joining an organisation.
 *
 * Membership is only ever created from a valid invitation addressed to the
 * signed-in account. There is deliberately no way to search for a company and
 * request access by name — that would turn the organisation directory into a
 * discovery surface and invite exactly the guessing the backend refuses.
 */

const primary =
  'px-5 py-3 rounded-xl bg-gold-500 text-slate-950 text-[10px] font-black uppercase tracking-widest ' +
  'hover:brightness-110 transition disabled:opacity-40 flex items-center justify-center gap-2';
const ghost =
  'px-5 py-3 rounded-xl border border-slate-700 text-slate-300 text-[10px] font-black uppercase ' +
  'tracking-widest hover:bg-slate-800 transition disabled:opacity-40 flex items-center justify-center gap-2';

const Shell: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <div className="min-h-[100dvh] w-full bg-slate-950 text-white font-sans">
    <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-black uppercase italic tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1">{subtitle}</p>
        )}
      </div>
      <Link to="/workspace" className={ghost}>
        <ArrowLeft className="w-3 h-3" /> Workspace
      </Link>
    </div>

    <div className="px-6 py-12 flex justify-center">
      <div className="w-full max-w-xl space-y-5">{children}</div>
    </div>
  </div>
);

/**
 * /organization/join and /invitations — the invitations addressed to this
 * account.
 */
export const InvitationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh, setActiveOrganization } = useOrganization();
  const { invitations, loading, error, accepting, hasInvitations, accept, decline, reload } = useInvitations();

  const [actionError, setActionError] = useState<string | null>(null);

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

  return (
    <Shell title="Join an organisation" subtitle="Invitations for your account">
      {actionError && (
        <div role="alert" className="bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3">
          <p className="text-[11px] text-rose-300">{actionError}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <Loader2 className="w-4 h-4 animate-spin text-gold-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Checking your invitations
          </span>
        </div>
      ) : error ? (
        <div className="bg-rose-950/20 border border-rose-900/40 rounded-2xl p-6 text-center space-y-4">
          <AlertCircle className="w-6 h-6 text-rose-400 mx-auto" />
          <p className="text-[12px] text-slate-300">{error}</p>
          <button onClick={() => void reload()} className={`${primary} mx-auto`}>
            Try again
          </button>
        </div>
      ) : hasInvitations ? (
        invitations.map(invitation => (
          <div key={invitation.id} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4 text-gold-500" />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-bold text-white truncate">{invitation.organization_name}</p>
                <p className="text-[11px] text-slate-500">
                  Invited as {ROLE_LABELS[invitation.role] ?? invitation.role}
                  {invitation.invited_by_name ? ` by ${invitation.invited_by_name}` : ''}
                </p>
                <p className="text-[10px] text-slate-600">
                  Expires {new Date(invitation.expires_at).toLocaleDateString('en-GB')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
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
              >
                <X className="w-3.5 h-3.5" /> Decline
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
          <Mail className="w-6 h-6 text-slate-600 mx-auto" />
          <div className="space-y-2">
            <p className="text-sm font-bold text-white">No pending invitations</p>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              Nothing is waiting for {user?.email}. Ask a colleague to invite that exact address, or create your own
              organisation.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => void reload()} className={ghost}>
              Check again
            </button>
            <button onClick={() => navigate('/organization/create')} className={primary}>
              Create organisation
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
};

/**
 * /invitations/:token — opening an invite link.
 *
 * The token authorises the lookup, so this works before the recipient belongs
 * to the organisation. An email mismatch is reported explicitly rather than
 * hidden: someone who followed a link from their inbox but signed in with a
 * different account needs to be told which address to use.
 */
export const InvitationByTokenPage: React.FC = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh, setActiveOrganization } = useOrganization();

  const [invitation, setInvitation] = useState<InvitationByToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    invitationApi
      .byToken(token)
      .then(result => active && setInvitation(result))
      .catch(err => active && setError(describeApiError(err)))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [token]);

  const onAccept = async () => {
    if (!invitation) return;
    setBusy(true);
    setError(null);
    try {
      await invitationApi.accept(invitation.id);
      await refresh();
      setActiveOrganization(invitation.organization_id);
      navigate('/dashboard');
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Shell title="Invitation">
        <div className="flex items-center justify-center gap-3 py-16">
          <Loader2 className="w-4 h-4 animate-spin text-gold-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Opening invitation</span>
        </div>
      </Shell>
    );
  }

  if (error || !invitation) {
    return (
      <Shell title="Invitation">
        <div className="bg-rose-950/20 border border-rose-900/40 rounded-2xl p-8 text-center space-y-4">
          <AlertCircle className="w-6 h-6 text-rose-400 mx-auto" />
          <p className="text-[12px] text-slate-300">{error ?? 'That invitation link is not valid.'}</p>
          <button onClick={() => navigate('/workspace')} className={`${primary} mx-auto`}>
            Back to workspace
          </button>
        </div>
      </Shell>
    );
  }

  const unusable =
    invitation.is_expired || invitation.status !== 'pending' || !invitation.matches_caller;

  const reason = invitation.is_expired
    ? 'This invitation has expired. Ask for a new one.'
    : invitation.status === 'accepted'
      ? 'This invitation has already been used.'
      : invitation.status === 'revoked'
        ? 'This invitation was revoked.'
        : invitation.status === 'declined'
          ? 'This invitation was declined.'
          : !invitation.matches_caller
            ? `This invitation is addressed to ${invitation.email}, but you are signed in as ${user?.email}. Sign in with the invited address to accept it.`
            : null;

  return (
    <Shell title="Invitation">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 space-y-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-gold-500" />
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">
            You have been invited to join
          </p>
          <h2 className="text-2xl font-black tracking-tight">{invitation.organization_name}</h2>
          <p className="text-[12px] text-slate-400">
            as {ROLE_LABELS[invitation.role] ?? invitation.role}
            {invitation.invited_by_name ? ` · invited by ${invitation.invited_by_name}` : ''}
          </p>
        </div>

        {reason ? (
          <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl px-4 py-3">
            <p className="text-[11px] text-amber-200 leading-relaxed">{reason}</p>
          </div>
        ) : (
          <button onClick={() => void onAccept()} disabled={busy} className={`${primary} mx-auto`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Accept invitation
          </button>
        )}

        {unusable && (
          <button onClick={() => navigate('/workspace')} className={`${ghost} mx-auto`}>
            Back to workspace
          </button>
        )}
      </div>
    </Shell>
  );
};
