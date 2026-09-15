import { api } from './client';
import type { OrgRole } from '../../../database.types';

/**
 * Administrative API. Every endpoint requires admin or owner server-side;
 * hiding the UI is a convenience, not the control.
 */

export interface AdminOverview {
  metrics: {
    activeUsers: number;
    inventorySkus: number;
    inventoryValue: number;
    activeTenders: number;
    discoveryRuns: number;
    rfpsProcessed: number;
    rfpsFailed: number;
    highRiskRfps: number;
    expiringDocuments: number;
  };
  recentDiscoveryRuns: {
    id: string;
    portal: string;
    status: string;
    total_qualified: number;
    total_found: number;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
  }[];
  recentRfps: {
    id: string;
    title: string | null;
    buyer: string | null;
    status: string;
    created_at: string;
    processing_seconds: number | null;
  }[];
  recentActivity: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  actorName?: string | null;
  metadata: Record<string, unknown>;
  ip_address?: string | null;
  request_id?: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  user_id: string;
  role: OrgRole;
  status: 'invited' | 'active' | 'suspended';
  joined_at: string | null;
  created_at: string;
  profiles: { id: string; full_name: string | null; email: string | null; avatar_url: string | null } | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  status: string;
  created_at: string;
  expires_at: string;
}

const withOrg = (path: string, organizationId: string) =>
  `${path}?organizationId=${encodeURIComponent(organizationId)}`;

export const adminApi = {
  overview: (organizationId: string) =>
    api.get<{ data: AdminOverview }>(withOrg('/api/admin/overview', organizationId)).then(r => r.data),

  listMembers: (organizationId: string) =>
    api.get<{ data: Member[] }>(withOrg('/api/admin/members', organizationId)).then(r => r.data),

  listInvitations: (organizationId: string) =>
    api.get<{ data: Invitation[] }>(withOrg('/api/admin/invitations', organizationId)).then(r => r.data),

  invite: (organizationId: string, email: string, role: Exclude<OrgRole, 'owner'>) =>
    api.post<{ data: Invitation }>('/api/admin/invitations', { organizationId, email, role }),

  revokeInvitation: (organizationId: string, invitationId: string) =>
    api.delete<{ data: { id: string } }>(
      withOrg(`/api/admin/invitations/${encodeURIComponent(invitationId)}`, organizationId)
    ),

  changeRole: (organizationId: string, memberId: string, role: OrgRole) =>
    api.put<{ data: { id: string; role: OrgRole } }>(`/api/admin/members/${encodeURIComponent(memberId)}/role`, {
      organizationId,
      role,
    }),

  changeStatus: (organizationId: string, memberId: string, status: 'active' | 'suspended') =>
    api.put<{ data: { id: string; status: string } }>(`/api/admin/members/${encodeURIComponent(memberId)}/status`, {
      organizationId,
      status,
    }),

  removeMember: (organizationId: string, memberId: string) =>
    api.delete<{ data: { id: string } }>(withOrg(`/api/admin/members/${encodeURIComponent(memberId)}`, organizationId)),

  auditLogs: (organizationId: string, options: { limit?: number; offset?: number; action?: string } = {}) => {
    const params = new URLSearchParams({ organizationId });
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.action) params.set('action', options.action);
    return api.get<{ data: AuditEntry[]; total: number }>(`/api/admin/audit-logs?${params.toString()}`);
  },
};
