import { Request, Response } from 'express';
import { z } from 'zod';
import { fail, ok } from '../middleware/errorHandler';
import { validated } from '../middleware/validate';
import { recordAudit } from '../services/audit/auditLog';
import { serviceClient, hasServiceRole } from '../db/supabase';
import type { OrgRole } from '../../database.types';

/**
 * Administrative surface: members, roles, invitations, audit history and the
 * dashboard aggregate.
 *
 * Every route is mounted behind requireOrgMember('admin'). Role changes have
 * an additional rule the database also enforces: an organisation must always
 * retain at least one owner, and only an owner may create another owner.
 */

export const inviteSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email().max(200),
  role: z.enum(['admin', 'manager', 'member', 'viewer']),
});

export const roleChangeSchema = z.object({
  organizationId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'manager', 'member', 'viewer']),
});

export const memberStatusSchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(['active', 'suspended']),
});

/* ───────────────────────────── overview ─────────────────────────────── */

/**
 * Dashboard aggregate.
 *
 * Uses head+count queries rather than fetching rows: the overview needs
 * counts, and pulling every inventory row to call .length on it is how the
 * dashboard would slow to a crawl for a large tenant.
 */
export async function getOverview(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const db = auth.db;
  const nowIso = new Date().toISOString();
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const countOf = async (
    table: 'organization_members' | 'inventory_items' | 'tenders' | 'discovery_runs' | 'tender_analyses' | 'compliance_documents',
    build: (q: any) => any = q => q
  ): Promise<number> => {
    const { count, error } = await build(
      db.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', org.id)
    );
    if (error) return 0;
    return count ?? 0;
  };

  const [
    activeUsers,
    inventorySkus,
    activeTenders,
    discoveryRuns,
    rfpsProcessed,
    rfpsFailed,
    expiringDocuments,
  ] = await Promise.all([
    countOf('organization_members', q => q.eq('status', 'active')),
    countOf('inventory_items', q => q.eq('is_active', true)),
    countOf('tenders', q => q.gte('closing_at', nowIso)),
    countOf('discovery_runs'),
    countOf('tender_analyses', q => q.eq('status', 'Complete')),
    countOf('tender_analyses', q => q.eq('status', 'Error')),
    countOf('compliance_documents', q => q.is('archived_at', null).lte('expiry_date', in30Days)),
  ]);

  // Inventory value is derived from the rows, so it needs the numbers — but
  // only those two columns, and only for active items.
  const { data: valueRows } = await db
    .from('inventory_items')
    .select('available_quantity, unit_sales_price')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .limit(5000);

  const inventoryValue = (valueRows ?? []).reduce(
    (sum, row) => sum + (row.available_quantity ?? 0) * Number(row.unit_sales_price ?? 0),
    0
  );

  const [{ data: recentRuns }, { data: recentRfps }, { data: recentActivity }] = await Promise.all([
    db
      .from('discovery_runs')
      .select('id, portal, status, total_qualified, total_found, started_at, completed_at, error_message')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('tender_analyses')
      .select('id, title, buyer, status, created_at, processing_seconds')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, actor_user_id, created_at, metadata')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .limit(15),
  ]);

  // High-risk is derived from stored analysis, not guessed: an RFP counts as
  // high risk when its persisted risk list holds a High entry.
  const { data: riskRows } = await db
    .from('tender_analyses')
    .select('id, risk_analysis')
    .eq('organization_id', org.id)
    .eq('status', 'Complete')
    .order('created_at', { ascending: false })
    .limit(100);

  const highRiskRfps = (riskRows ?? []).filter(row => {
    const risks = row.risk_analysis;
    return Array.isArray(risks) && risks.some((r: unknown) => (r as { riskLevel?: string })?.riskLevel === 'High');
  }).length;

  return ok(res, {
    metrics: {
      activeUsers,
      inventorySkus,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      activeTenders,
      discoveryRuns,
      rfpsProcessed,
      rfpsFailed,
      highRiskRfps,
      expiringDocuments,
    },
    recentDiscoveryRuns: recentRuns ?? [],
    recentRfps: recentRfps ?? [],
    recentActivity: recentActivity ?? [],
  });
}

/* ───────────────────────────── members ──────────────────────────────── */

export async function listMembers(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;

  const { data, error } = await auth.db
    .from('organization_members')
    .select('id, user_id, role, status, invited_at, joined_at, created_at, profiles:user_id (id, full_name, email, avatar_url)')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: true });

  if (error) return fail(res, 500, 'MEMBERS_FETCH_FAILED', 'The member list could not be loaded.');
  return ok(res, data ?? []);
}

/**
 * Invites a user by email.
 *
 * Creates an invitation row rather than a membership: the person must sign in
 * with Supabase Auth and accept, so an admin cannot manufacture a session for
 * an address they do not control.
 */
export async function inviteMember(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof inviteSchema>>(req);
  const email = input.email.trim().toLowerCase();

  const { data: existing } = await auth.db
    .from('invitations')
    .select('id, status')
    .eq('organization_id', org.id)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) {
    return fail(res, 409, 'ALREADY_INVITED', 'An invitation is already pending for this address.');
  }

  const { data, error } = await auth.db
    .from('invitations')
    .insert({
      organization_id: org.id,
      email,
      role: input.role,
      invited_by: auth.userId,
      status: 'pending',
    } as never)
    .select('id, email, role, status, created_at')
    .single();

  if (error) return fail(res, 403, 'INVITE_FAILED', 'The invitation could not be created.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'member.invited',
      entityType: 'invitation',
      entityId: data.id,
      metadata: { email, role: input.role },
    },
    req
  );

  return ok(res, data);
}

export async function listInvitations(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;

  const { data, error } = await auth.db
    .from('invitations')
    .select('id, email, role, status, created_at, expires_at')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return fail(res, 500, 'INVITES_FETCH_FAILED', 'Invitations could not be loaded.');
  return ok(res, data ?? []);
}

export async function revokeInvitation(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const id = String(req.params.invitationId);

  const { data, error } = await auth.db
    .from('invitations')
    .update({ status: 'revoked' } as never)
    .eq('id', id)
    .eq('organization_id', org.id)
    .select('id');

  if (error) return fail(res, 403, 'REVOKE_FAILED', 'The invitation could not be revoked.');
  if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Invitation not found.');

  return ok(res, { id, revoked: true });
}

/**
 * Changes a member's role.
 *
 * Two guards beyond RLS: only an owner may grant ownership, and the last
 * owner may not be demoted — otherwise an organisation can be left with
 * nobody able to administer it.
 */
export async function changeMemberRole(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof roleChangeSchema>>(req);
  const memberId = String(req.params.memberId);

  if (input.role === 'owner' && org.role !== 'owner') {
    return fail(res, 403, 'OWNER_ONLY', 'Only an owner can grant ownership.');
  }

  const { data: member, error: lookupError } = await auth.db
    .from('organization_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .eq('organization_id', org.id)
    .maybeSingle();

  if (lookupError) return fail(res, 500, 'MEMBER_LOOKUP_FAILED', 'The member could not be loaded.');
  if (!member) return fail(res, 404, 'NOT_FOUND', 'Member not found.');

  if (member.role === 'owner' && input.role !== 'owner') {
    const { count } = await auth.db
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('role', 'owner')
      .eq('status', 'active');

    if ((count ?? 0) <= 1) {
      return fail(res, 409, 'LAST_OWNER', 'An organisation must keep at least one owner.');
    }
  }

  const { error } = await auth.db
    .from('organization_members')
    .update({ role: input.role as OrgRole } as never)
    .eq('id', memberId)
    .eq('organization_id', org.id);

  if (error) return fail(res, 403, 'ROLE_CHANGE_FAILED', 'The role could not be changed.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'member.role_changed',
      entityType: 'organization_member',
      entityId: memberId,
      metadata: { from: member.role, to: input.role, targetUserId: member.user_id },
    },
    req
  );

  return ok(res, { id: memberId, role: input.role });
}

/** Suspends or reactivates a member. Suspension revokes data access via RLS. */
export async function changeMemberStatus(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof memberStatusSchema>>(req);
  const memberId = String(req.params.memberId);

  const { data: member } = await auth.db
    .from('organization_members')
    .select('id, user_id, role, status')
    .eq('id', memberId)
    .eq('organization_id', org.id)
    .maybeSingle();

  if (!member) return fail(res, 404, 'NOT_FOUND', 'Member not found.');

  if (member.user_id === auth.userId && input.status === 'suspended') {
    return fail(res, 409, 'CANNOT_SUSPEND_SELF', 'You cannot suspend your own membership.');
  }

  if (member.role === 'owner' && input.status === 'suspended') {
    const { count } = await auth.db
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('role', 'owner')
      .eq('status', 'active');

    if ((count ?? 0) <= 1) {
      return fail(res, 409, 'LAST_OWNER', 'An organisation must keep at least one active owner.');
    }
  }

  const { error } = await auth.db
    .from('organization_members')
    .update({ status: input.status } as never)
    .eq('id', memberId)
    .eq('organization_id', org.id);

  if (error) return fail(res, 403, 'STATUS_CHANGE_FAILED', 'The member status could not be changed.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'member.status_changed',
      entityType: 'organization_member',
      entityId: memberId,
      metadata: { from: member.status, to: input.status, targetUserId: member.user_id },
    },
    req
  );

  return ok(res, { id: memberId, status: input.status });
}

/* ─────────────────────────── audit history ──────────────────────────── */

export async function listAuditLogs(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;

  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;

  let builder = auth.db
    .from('audit_logs')
    .select('id, action, entity_type, entity_id, actor_user_id, metadata, ip_address, request_id, created_at', {
      count: 'exact',
    })
    .eq('organization_id', org.id);

  if (action) builder = builder.eq('action', action);

  const { data, error, count } = await builder
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return fail(res, 500, 'AUDIT_FETCH_FAILED', 'The audit log could not be loaded.');

  // Resolve actor names in one round trip rather than N.
  const actorIds = [...new Set((data ?? []).map(r => r.actor_user_id).filter(Boolean))] as string[];
  const actors = new Map<string, string>();

  if (actorIds.length > 0) {
    const { data: profiles } = await auth.db.from('profiles').select('id, full_name, email').in('id', actorIds);
    for (const p of profiles ?? []) actors.set(p.id, p.full_name || p.email || 'Unknown');
  }

  return ok(
    res,
    (data ?? []).map(row => ({ ...row, actorName: row.actor_user_id ? actors.get(row.actor_user_id) ?? null : null })),
    { total: count ?? 0 }
  );
}

/**
 * Removes a member outright.
 *
 * Done with the service role: deleting a membership row is a privileged act
 * and the delete policy intentionally does not allow an admin to remove an
 * owner. The owner-count invariant is re-checked here first.
 */
export async function removeMember(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const memberId = String(req.params.memberId);

  if (!hasServiceRole) {
    return fail(res, 503, 'UNAVAILABLE', 'Member removal is not available on this deployment.');
  }

  const { data: member } = await auth.db
    .from('organization_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .eq('organization_id', org.id)
    .maybeSingle();

  if (!member) return fail(res, 404, 'NOT_FOUND', 'Member not found.');
  if (member.user_id === auth.userId) {
    return fail(res, 409, 'CANNOT_REMOVE_SELF', 'You cannot remove your own membership.');
  }
  if (member.role === 'owner' && org.role !== 'owner') {
    return fail(res, 403, 'OWNER_ONLY', 'Only an owner can remove another owner.');
  }
  if (member.role === 'owner') {
    const { count } = await auth.db
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('role', 'owner')
      .eq('status', 'active');
    if ((count ?? 0) <= 1) {
      return fail(res, 409, 'LAST_OWNER', 'An organisation must keep at least one owner.');
    }
  }

  // Service-role write: the organization_id predicate is mandatory here,
  // because RLS is not enforcing tenancy on this client.
  const { error } = await serviceClient()
    .from('organization_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', org.id);

  if (error) return fail(res, 500, 'REMOVE_FAILED', 'The member could not be removed.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'member.removed',
      entityType: 'organization_member',
      entityId: memberId,
      metadata: { targetUserId: member.user_id, role: member.role },
    },
    req
  );

  return ok(res, { id: memberId, removed: true });
}
