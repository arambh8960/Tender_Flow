import { api } from './client';
import type { OrgRole } from '../../../database.types';

/**
 * Invitations addressed to the signed-in user.
 *
 * Note there is no organizationId on these calls. That is the point: an
 * invitation is how someone reaches an organisation they do not yet belong
 * to, so the server matches it against the caller's own verified email rather
 * than against a tenant they would have to already be inside.
 */

export interface PendingInvitation {
  id: string;
  organization_id: string;
  organization_name: string;
  role: OrgRole;
  invited_by_name: string | null;
  expires_at: string;
  created_at: string;
}

export interface AcceptedMembership {
  id: string;
  organization_id: string;
  role: OrgRole;
  status: string;
}

/** What an invite link resolves to, before the recipient acts on it. */
export interface InvitationByToken {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  role: OrgRole;
  status: string;
  invited_by_name: string | null;
  expires_at: string;
  is_expired: boolean;
  /** False when the link was opened by a different signed-in account. */
  matches_caller: boolean;
}

export const invitationApi = {
  listMine: () => api.get<{ data: PendingInvitation[] }>('/api/invitations/mine').then(r => r.data),

  accept: (invitationId: string) =>
    api.post<{ data: AcceptedMembership }>('/api/invitations/accept', { invitationId }).then(r => r.data),

  decline: (invitationId: string) =>
    api.post<{ data: { declined: boolean } }>('/api/invitations/decline', { invitationId }).then(r => r.data),

  byToken: (token: string) =>
    api.get<{ data: InvitationByToken }>(`/api/invitations/token/${encodeURIComponent(token)}`).then(r => r.data),
};

export interface CreateOrganizationInput {
  name: string;
  legalName?: string;
  address?: string;
  gstin?: string;
  pan?: string;
  domain?: string;
  industry?: string;
  annualTurnoverCr?: number;
  turnoverYear?: string;
  oemStatus?: string;
}

export const organizationAccountApi = {
  /**
   * Creates the organisation and the caller's OWNER membership in one server
   * transaction. Note the absence of a role parameter — the client cannot ask
   * to be an owner, it becomes one by creating the workspace.
   */
  create: (input: CreateOrganizationInput) =>
    api
      .post<{ data: { id: string; name: string; slug: string } }>('/api/organizations', input)
      .then(r => r.data),
};
