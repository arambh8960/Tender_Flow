import { Router } from 'express';
import {
  getOverview,
  listMembers,
  inviteMember,
  listInvitations,
  revokeInvitation,
  changeMemberRole,
  changeMemberStatus,
  removeMember,
  listAuditLogs,
  inviteSchema,
  roleChangeSchema,
  memberStatusSchema,
} from '../controllers/admin.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireOrgMember } from '../middleware/auth';
import { validate } from '../middleware/validate';

/**
 * Every route here requires admin or owner.
 *
 * The guard is attached per route rather than via router.use, because the
 * ordering matters: validate() is what parses organizationId out of the
 * body, and requireOrgMember is what verifies membership of it.
 */
const router = Router();

router.get(
  '/admin/overview',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(getOverview)
);

router.get(
  '/admin/members',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(listMembers)
);

router.get(
  '/admin/invitations',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(listInvitations)
);

router.get(
  '/admin/audit-logs',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(listAuditLogs)
);

router.post(
  '/admin/invitations',
  asyncHandler(requireAuth),
  validate(inviteSchema),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(inviteMember)
);

router.delete(
  '/admin/invitations/:invitationId',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(revokeInvitation)
);

router.put(
  '/admin/members/:memberId/role',
  asyncHandler(requireAuth),
  validate(roleChangeSchema),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(changeMemberRole)
);

router.put(
  '/admin/members/:memberId/status',
  asyncHandler(requireAuth),
  validate(memberStatusSchema),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(changeMemberStatus)
);

router.delete(
  '/admin/members/:memberId',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(removeMember)
);

export default router;
