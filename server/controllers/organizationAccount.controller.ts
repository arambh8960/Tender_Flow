import { Request, Response } from 'express';
import { z } from 'zod';

import { fail, ok } from '../middleware/errorHandler';
import { validated } from '../middleware/validate';
import { recordAudit } from '../services/audit/auditLog';

/**
 * Organisation account lifecycle: creating one, and joining one by invitation.
 *
 * The rule both halves enforce is the same — the CLIENT never decides who owns
 * what. Ownership is minted only by creating an organisation, and an
 * invitation can never confer it. Both operations run through SECURITY
 * DEFINER functions so the membership row is written in the same transaction
 * as the thing that justifies it, and so `organization_members` needs no
 * client-writable INSERT policy (which would be a self-promotion hole).
 */

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(160),
  legalName: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(15).optional(),
  domain: z.string().max(160).optional(),
  industry: z.string().max(120).optional(),
  annualTurnoverCr: z.number().nonnegative().max(10_000_000).optional(),
  turnoverYear: z.string().max(20).optional(),
  oemStatus: z.string().max(60).optional(),
});

export const acceptInvitationSchema = z.object({
  invitationId: z.string().uuid(),
});

export const declineInvitationSchema = z.object({
  invitationId: z.string().uuid(),
});

/**
 * POST /api/organizations
 *
 * Note what is absent from the schema: `role`, and `organizationId`. A caller
 * cannot ask to be an owner — they become one because they created the thing.
 */
export async function createOrganization(req: Request, res: Response) {
  const auth = req.auth!;
  const input = validated<z.infer<typeof createOrganizationSchema>>(req);

  const { data, error } = await auth.db.rpc('create_organization', {
    p_name: input.name,
    p_slug: null,
    p_industry: input.industry ?? null,
    p_legal_name: input.legalName ?? null,
    p_address: input.address ?? null,
    p_gstin: input.gstin ?? null,
    p_pan: input.pan ?? null,
    p_domain: input.domain ?? null,
    p_annual_turnover_cr: input.annualTurnoverCr ?? null,
    p_turnover_year: input.turnoverYear ?? null,
    p_oem_status: input.oemStatus ?? null,
  } as never);

  if (error || !data) {
    const message = error?.message ?? 'The organisation could not be created.';
    if (/not authenticated/i.test(message)) {
      return fail(res, 401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.');
    }
    if (/name is required/i.test(message)) {
      return fail(res, 422, 'INVALID_NAME', 'An organisation name is required.');
    }
    console.error(`[${req.requestId}] create_organization failed:`, message);
    return fail(res, 500, 'ORGANIZATION_CREATE_FAILED', 'The organisation could not be created.');
  }

  const organization = data as unknown as { id: string; name: string; slug: string };

  await recordAudit(
    {
      organizationId: organization.id,
      actorUserId: auth.userId,
      action: 'organization.created',
      entityType: 'organization',
      entityId: organization.id,
      metadata: { name: organization.name, slug: organization.slug, createdBy: auth.email },
    },
    req
  );

  return ok(res, organization);
}

/**
 * GET /api/invitations/mine
 *
 * Invitations addressed to the caller's own verified email. Deliberately not
 * organisation-scoped: the point is to find invitations from organisations
 * the caller does NOT yet belong to.
 */
export async function listMyInvitations(req: Request, res: Response) {
  const auth = req.auth!;

  const { data, error } = await auth.db.rpc('my_pending_invitations' as never);

  if (error) {
    console.error(`[${req.requestId}] my_pending_invitations failed:`, error.message);
    return fail(res, 500, 'INVITATIONS_FETCH_FAILED', 'Your invitations could not be loaded.');
  }

  return ok(res, data ?? []);
}

/**
 * POST /api/invitations/accept
 *
 * The invitation is matched against the caller's own email inside the
 * database function, so an id belonging to someone else is reported as "not
 * found" rather than "forbidden" — otherwise this endpoint becomes a way to
 * discover who has been invited where.
 */
export async function acceptInvitation(req: Request, res: Response) {
  const auth = req.auth!;
  const input = validated<z.infer<typeof acceptInvitationSchema>>(req);

  const { data, error } = await auth.db.rpc('accept_invitation', {
    p_invitation_id: input.invitationId,
  } as never);

  if (error) {
    const message = error.message ?? '';

    if (/not found/i.test(message)) {
      return fail(res, 404, 'INVITATION_NOT_FOUND', 'That invitation is not available to this account.');
    }
    if (/expired/i.test(message)) {
      return fail(res, 410, 'INVITATION_EXPIRED', 'This invitation has expired. Ask for a new one.');
    }
    if (/revoked/i.test(message)) {
      return fail(res, 410, 'INVITATION_REVOKED', 'This invitation has been revoked.');
    }
    if (/already been used/i.test(message)) {
      return fail(res, 409, 'INVITATION_USED', 'This invitation has already been used.');
    }
    if (/no email address/i.test(message)) {
      return fail(res, 409, 'NO_EMAIL', 'This account has no email address, so invitations cannot be matched to it.');
    }

    console.error(`[${req.requestId}] accept_invitation failed:`, message);
    return fail(res, 500, 'INVITATION_ACCEPT_FAILED', 'The invitation could not be accepted.');
  }

  const membership = data as unknown as { organization_id: string; role: string; id: string };

  await recordAudit(
    {
      organizationId: membership.organization_id,
      actorUserId: auth.userId,
      action: 'member.invited',
      entityType: 'organization_member',
      entityId: membership.id,
      metadata: { acceptedBy: auth.email, role: membership.role, invitationId: input.invitationId },
    },
    req
  );

  return ok(res, membership);
}

/**
 * GET /api/invitations/token/:token
 *
 * Resolves an invite link. The token is the credential — 24 random bytes —
 * so this is reachable before the caller belongs to the organisation, which
 * is the whole point of an invite link.
 *
 * It deliberately reports an email mismatch rather than hiding the
 * invitation: someone who followed a link from their inbox and signed in with
 * a different account needs to be told that, not shown "not found".
 */
export async function getInvitationByToken(req: Request, res: Response) {
  const auth = req.auth!;
  const token = String(req.params.token ?? '');

  if (token.length < 16) {
    return fail(res, 400, 'INVALID_TOKEN', 'That invitation link is not valid.');
  }

  const { data, error } = await auth.db.rpc('invitation_by_token', { p_token: token } as never);

  if (error) {
    console.error(`[${req.requestId}] invitation_by_token failed:`, error.message);
    return fail(res, 500, 'INVITATION_LOOKUP_FAILED', 'That invitation could not be loaded.');
  }

  const invitation = Array.isArray(data) ? data[0] : data;
  if (!invitation) return fail(res, 404, 'INVITATION_NOT_FOUND', 'That invitation link is not valid.');

  return ok(res, invitation);
}

/** Declines an invitation. Recorded, so the inviting admin can see the answer. */
export async function declineInvitation(req: Request, res: Response) {
  const auth = req.auth!;
  const input = validated<z.infer<typeof declineInvitationSchema>>(req);

  const { data, error } = await auth.db.rpc('decline_invitation', {
    p_invitation_id: input.invitationId,
  } as never);

  if (error) {
    if (/not found/i.test(error.message ?? '')) {
      return fail(res, 404, 'INVITATION_NOT_FOUND', 'That invitation is not available to this account.');
    }
    return fail(res, 500, 'INVITATION_DECLINE_FAILED', 'The invitation could not be declined.');
  }

  return ok(res, { declined: Boolean(data) });
}
