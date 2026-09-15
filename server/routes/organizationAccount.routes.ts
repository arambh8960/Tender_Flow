import { Router } from 'express';
import {
  createOrganization,
  listMyInvitations,
  acceptInvitation,
  getInvitationByToken,
  declineInvitation,
  createOrganizationSchema,
  acceptInvitationSchema,
  declineInvitationSchema,
} from '../controllers/organizationAccount.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimit';

/**
 * Account-level organisation routes.
 *
 * These deliberately do NOT use requireOrgMember: they are the endpoints a
 * user reaches when they belong to no organisation yet. Authorisation is
 * therefore "is this a valid Supabase session", and the database functions
 * decide what that session is entitled to do.
 */
const router = Router();

router.post(
  '/organizations',
  authLimiter,
  asyncHandler(requireAuth),
  validate(createOrganizationSchema),
  asyncHandler(createOrganization)
);

router.get('/invitations/mine', asyncHandler(requireAuth), asyncHandler(listMyInvitations));

// Resolving an invite link: reachable before membership exists, because the
// token is what authorises the lookup.
router.get('/invitations/token/:token', asyncHandler(requireAuth), asyncHandler(getInvitationByToken));

router.post(
  '/invitations/decline',
  authLimiter,
  asyncHandler(requireAuth),
  validate(declineInvitationSchema),
  asyncHandler(declineInvitation)
);

router.post(
  '/invitations/accept',
  authLimiter,
  asyncHandler(requireAuth),
  validate(acceptInvitationSchema),
  asyncHandler(acceptInvitation)
);

export default router;
