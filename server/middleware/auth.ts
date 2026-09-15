import { Request, Response, NextFunction } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, OrgRole } from '../../database.types';
import { userClient, verifyAccessToken, isSupabaseConfigured } from '../db/supabase';
import { fail } from './errorHandler';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string | null;
        accessToken: string;
        /** RLS-enforced client bound to this caller. */
        db: SupabaseClient<Database>;
      };
      org?: {
        id: string;
        role: OrgRole;
      };
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Requires a valid Supabase session.
 *
 * Attaches an RLS-enforced Supabase client scoped to the caller, so handlers
 * cannot accidentally query as a privileged role.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isSupabaseConfigured) {
    return fail(res, 503, 'AUTH_UNAVAILABLE', 'Authentication is not configured on this server.');
  }

  const token = bearer(req);
  if (!token) {
    return fail(res, 401, 'UNAUTHENTICATED', 'A bearer token is required.');
  }

  const user = await verifyAccessToken(token);
  if (!user) {
    return fail(res, 401, 'INVALID_TOKEN', 'The session token is invalid or has expired.');
  }

  req.auth = { userId: user.id, email: user.email, accessToken: token, db: userClient(token) };
  next();
}

/**
 * Requires active membership of the organisation named by the request.
 *
 * The organisation id arrives from the client, so it is verified against
 * organization_members here rather than trusted — that check is what closes
 * the IDOR path where a caller simply passes someone else's organisation id.
 * RLS would still block the underlying rows; this turns a confusing empty
 * result into an explicit 403.
 */
export function requireOrgMember(minimumRole: OrgRole = 'viewer') {
  const rank: Record<OrgRole, number> = { owner: 50, admin: 40, manager: 30, member: 20, viewer: 10 };

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return fail(res, 401, 'UNAUTHENTICATED', 'A bearer token is required.');
    }

    const organizationId =
      (req.body?.organizationId as string | undefined) ??
      (req.query?.organizationId as string | undefined) ??
      (req.params?.organizationId as string | undefined);

    if (!organizationId) {
      return fail(res, 400, 'ORGANIZATION_REQUIRED', 'An organizationId is required.');
    }

    const { data, error } = await req.auth.db
      .from('organization_members')
      .select('role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', req.auth.userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      return fail(res, 500, 'MEMBERSHIP_LOOKUP_FAILED', 'Could not verify organisation membership.');
    }
    if (!data) {
      return fail(res, 403, 'NOT_A_MEMBER', 'You do not have access to this organisation.');
    }

    const role = data.role as OrgRole;
    if (rank[role] < rank[minimumRole]) {
      return fail(res, 403, 'INSUFFICIENT_ROLE', `This action requires the ${minimumRole} role or above.`);
    }

    req.org = { id: organizationId, role };
    next();
  };
}

/**
 * Requires that the caller authenticated RECENTLY, not merely that they hold
 * a valid session.
 *
 * A long-lived refreshed session proves the account was signed into at some
 * point; it does not prove the person at the keyboard right now is the owner.
 * For a step-up action — resetting the vault PIN — the client sends the user
 * back through Supabase (a fresh OTP, or an OAuth round trip) and the new
 * token carries a recent issued-at. This checks that claim rather than
 * trusting the client's assertion that it happened.
 *
 * `iat` is read from the JWT payload without verifying the signature here,
 * which is safe only because requireAuth has already validated the token with
 * Supabase; this runs strictly after it.
 */
export function requireRecentAuth(maxAgeSeconds = 15 * 60) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return fail(res, 401, 'UNAUTHENTICATED', 'A bearer token is required.');
    }

    const [, payload] = req.auth.accessToken.split('.');
    if (!payload) {
      return fail(res, 401, 'INVALID_TOKEN', 'The session token is malformed.');
    }

    let issuedAt: number | undefined;
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { iat?: number };
      issuedAt = decoded.iat;
    } catch {
      return fail(res, 401, 'INVALID_TOKEN', 'The session token is malformed.');
    }

    if (typeof issuedAt !== 'number') {
      return fail(res, 401, 'INVALID_TOKEN', 'The session token carries no issue time.');
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
    if (ageSeconds > maxAgeSeconds) {
      return fail(
        res,
        403,
        'REAUTH_REQUIRED',
        'Confirm your identity again before changing this security setting.'
      );
    }

    next();
  };
}
