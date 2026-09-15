import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminOverview, type AuditEntry, type Invitation, type Member } from '../services/api/adminApi';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';
import type { OrgRole } from '../../database.types';

/** Admin dashboard aggregate. */
export function useAdminOverview() {
  const { activeOrganization, can } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;
  const allowed = can('members:manage');

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Skipped rather than attempted for non-admins: a predictable 403 is not
    // worth a request, and the server enforces it regardless.
    if (!organizationId || !allowed) {
      setOverview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setOverview(await adminApi.overview(organizationId));
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId, allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  return { overview, loading, error, reload: load, allowed };
}

/** Members and invitations. */
export function useMembers() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const [memberRows, inviteRows] = await Promise.all([
        adminApi.listMembers(organizationId),
        adminApi.listInvitations(organizationId),
      ]);
      setMembers(memberRows);
      setInvitations(inviteRows);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (operation: () => Promise<unknown>) => {
      setError(null);
      try {
        await operation();
        await load();
      } catch (err) {
        setError(describeApiError(err));
        throw err;
      }
    },
    [load]
  );

  return {
    members,
    invitations,
    loading,
    error,
    reload: load,
    invite: (email: string, role: Exclude<OrgRole, 'owner'>) =>
      act(() => adminApi.invite(organizationId as string, email, role)),
    revokeInvitation: (invitationId: string) =>
      act(() => adminApi.revokeInvitation(organizationId as string, invitationId)),
    changeRole: (memberId: string, role: OrgRole) =>
      act(() => adminApi.changeRole(organizationId as string, memberId, role)),
    changeStatus: (memberId: string, status: 'active' | 'suspended') =>
      act(() => adminApi.changeStatus(organizationId as string, memberId, status)),
    removeMember: (memberId: string) => act(() => adminApi.removeMember(organizationId as string, memberId)),
  };
}

/** Paginated audit history. */
export function useAuditLog(pageSize = 50) {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.auditLogs(organizationId, { limit: pageSize, offset, action: actionFilter });
      setEntries(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId, pageSize, offset, actionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    entries,
    total,
    offset,
    pageSize,
    loading,
    error,
    actionFilter,
    setActionFilter: (action: string | undefined) => {
      setOffset(0);
      setActionFilter(action);
    },
    next: () => setOffset(current => (current + pageSize < total ? current + pageSize : current)),
    previous: () => setOffset(current => Math.max(0, current - pageSize)),
    reload: load,
  };
}
