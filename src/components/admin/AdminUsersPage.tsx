import * as React from 'react';
import { useState } from 'react';
import { useMembers } from '../../hooks/useAdmin';
import { useOrganization } from '../../contexts/OrganizationContext';
import { ASSIGNABLE_ROLES, ROLE_LABELS } from '../../lib/authorization';
import { Panel, Spinner, ErrorNote, EmptyState, buttonClass, ghostButtonClass, inputClass } from './AdminShell';
import type { OrgRole } from '../../../database.types';

export const AdminUsersPage: React.FC = () => {
  const { role: myRole } = useOrganization();
  const {
    members,
    invitations,
    loading,
    error,
    invite,
    revokeInvitation,
    changeRole,
    changeStatus,
    removeMember,
  } = useMembers();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<OrgRole, 'owner'>>('member');
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingInvitations = invitations.filter(i => i.status === 'pending');

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;

    setInviting(true);
    setNotice(null);
    try {
      await invite(email.trim(), inviteRole);
      setNotice(`Invitation created for ${email.trim()}. They join once they sign in and accept.`);
      setEmail('');
    } catch {
      /* the hook surfaces the message */
    } finally {
      setInviting(false);
    }
  };

  if (loading && members.length === 0) return <Spinner label="Loading members" />;

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      <Panel title="Invite a user" subtitle="An invited user joins only after signing in and accepting.">
        <form onSubmit={submitInvite} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@company.com"
            className={inputClass}
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value as Exclude<OrgRole, 'owner'>)}
            className={`${inputClass} sm:w-44`}
          >
            {ASSIGNABLE_ROLES.map(r => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={inviting} className={`${buttonClass} sm:w-40`}>
            {inviting ? 'Inviting…' : 'Send invite'}
          </button>
        </form>
        {notice && <p className="text-[11px] text-emerald-400 mt-3">{notice}</p>}
      </Panel>

      <Panel title="Members" subtitle={`${members.length} member(s) in this workspace`}>
        {members.length === 0 ? (
          <EmptyState title="No members" message="Invite colleagues to collaborate in this workspace." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
                  <th className="pb-3 pr-4">Person</th>
                  <th className="pb-3 pr-4">Role</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map(member => {
                  // Only an owner may hand out ownership, and the server
                  // enforces the same rule regardless of what is rendered.
                  const roleOptions: OrgRole[] = myRole === 'owner' ? ['owner', ...ASSIGNABLE_ROLES] : ASSIGNABLE_ROLES;

                  return (
                    <tr key={member.id} className="border-t border-slate-800/60">
                      <td className="py-3 pr-4">
                        <p className="text-[12px] text-slate-200">{member.profiles?.full_name ?? 'Unnamed user'}</p>
                        <p className="text-[10px] text-slate-500">{member.profiles?.email ?? '—'}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          value={member.role}
                          onChange={e => void changeRole(member.id, e.target.value as OrgRole)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-white"
                        >
                          {roleOptions.map(r => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${
                            member.status === 'active'
                              ? 'bg-emerald-950/50 text-emerald-400'
                              : member.status === 'suspended'
                                ? 'bg-rose-950/50 text-rose-400'
                                : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() =>
                            void changeStatus(member.id, member.status === 'suspended' ? 'active' : 'suspended')
                          }
                          className={ghostButtonClass}
                        >
                          {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Remove this member from the workspace? They lose access immediately.')) {
                              void removeMember(member.id);
                            }
                          }}
                          className={ghostButtonClass}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Pending invitations" subtitle={`${pendingInvitations.length} awaiting acceptance`}>
        {pendingInvitations.length === 0 ? (
          <EmptyState title="No pending invitations" message="Everyone invited has either joined or been revoked." />
        ) : (
          <ul className="space-y-2">
            {pendingInvitations.map(invitation => (
              <li key={invitation.id} className="flex items-center justify-between gap-4 py-2 border-b border-slate-800/60 last:border-0">
                <div>
                  <p className="text-[12px] text-slate-200">{invitation.email}</p>
                  <p className="text-[10px] text-slate-500">
                    {ROLE_LABELS[invitation.role]} · expires {new Date(invitation.expires_at).toLocaleDateString('en-GB')}
                  </p>
                </div>
                <button onClick={() => void revokeInvitation(invitation.id)} className={ghostButtonClass}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
};
