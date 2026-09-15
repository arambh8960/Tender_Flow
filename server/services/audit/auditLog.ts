import type { Request } from 'express';
import { serviceClient, hasServiceRole } from '../../db/supabase';
import { clientIp } from '../../middleware/requestContext';

/**
 * Persistent audit trail.
 *
 * Written with the service role because audit_logs has no INSERT policy: if
 * clients could write it, the record of what they did would be forgeable.
 * Every call carries an explicit organization_id, since the service role
 * bypasses RLS and the database will not supply the tenant for us.
 *
 * Audit writes never fail a request. A failure to record history is a
 * logging problem, not a reason to reject the user's action — but it is
 * logged loudly so it cannot pass unnoticed.
 */

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'organization.created'
  | 'organization.profile_updated'
  | 'organization.settings_updated'
  | 'member.invited'
  | 'member.role_changed'
  | 'member.removed'
  | 'member.status_changed'
  | 'signing_authority.created'
  | 'signing_authority.updated'
  | 'signing_authority.deleted'
  | 'inventory.created'
  | 'inventory.updated'
  | 'inventory.stock_adjusted'
  | 'inventory.archived'
  | 'inventory.imported'
  | 'document.uploaded'
  | 'document.replaced'
  | 'document.downloaded'
  | 'document.archived'
  | 'discovery.started'
  | 'discovery.completed'
  | 'discovery.failed'
  | 'rfp.created'
  | 'rfp.processing_started'
  | 'rfp.processed'
  | 'rfp.failed'
  | 'agent.error'
  | 'security.url_blocked'
  | 'security.upload_rejected';

export interface AuditEntry {
  organizationId: string;
  actorUserId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntry, req?: Request): Promise<void> {
  if (!hasServiceRole) {
    console.warn('[audit] service role not configured — entry dropped:', entry.action);
    return;
  }

  try {
    const { error } = await serviceClient()
      .from('audit_logs')
      .insert({
        organization_id: entry.organizationId,
        actor_user_id: entry.actorUserId ?? req?.auth?.userId ?? null,
        action: entry.action,
        entity_type: entry.entityType ?? null,
        entity_id: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as never,
        ip_address: req ? clientIp(req) ?? null : null,
        user_agent: req?.headers['user-agent'] ?? null,
        request_id: req?.requestId ?? null,
      });

    if (error) console.error('[audit] insert failed:', error.message, entry.action);
  } catch (err) {
    console.error('[audit] insert threw:', err);
  }
}

/** Fire-and-forget variant for hot paths that must not await the write. */
export function recordAuditAsync(entry: AuditEntry, req?: Request): void {
  void recordAudit(entry, req);
}
