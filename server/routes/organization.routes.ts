import { Router } from 'express';
import {
  getCompanyProfile,
  updateCompanyProfile,
  updateDiscoverySettings,
  createSigningAuthority,
  deleteSigningAuthority,
  listInventory,
  createInventoryItem,
  updateInventoryItem,
  archiveInventoryItem,
  updateStock,
  getComplianceSnapshot,
  companyProfileSchema,
  discoverySettingsSchema,
  inventoryCreateSchema,
  inventoryUpdateSchema,
  stockSchema,
  signingAuthoritySchema,
} from '../controllers/organization.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireOrgMember } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

/* ── company profile and settings ──────────────────────────────────────── */

router.get(
  '/organization/profile',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(getCompanyProfile)
);

router.put(
  '/organization/profile',
  asyncHandler(requireAuth),
  validate(companyProfileSchema),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(updateCompanyProfile)
);

router.put(
  '/organization/discovery-settings',
  asyncHandler(requireAuth),
  validate(discoverySettingsSchema),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(updateDiscoverySettings)
);

router.post(
  '/organization/signing-authorities',
  asyncHandler(requireAuth),
  validate(signingAuthoritySchema),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(createSigningAuthority)
);

router.delete(
  '/organization/signing-authorities/:authorityId',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(deleteSigningAuthority)
);

/* ── inventory ─────────────────────────────────────────────────────────── */

router.get(
  '/inventory',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(listInventory)
);

router.post(
  '/inventory',
  asyncHandler(requireAuth),
  validate(inventoryCreateSchema),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(createInventoryItem)
);

router.put(
  '/inventory/:skuId',
  asyncHandler(requireAuth),
  validate(inventoryUpdateSchema),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(updateInventoryItem)
);

router.delete(
  '/inventory/:skuId',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(archiveInventoryItem)
);

router.post(
  '/inventory/stock',
  asyncHandler(requireAuth),
  validate(stockSchema),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(updateStock)
);

/* ── compliance snapshot ───────────────────────────────────────────────── */

router.get(
  '/compliance-check',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(getComplianceSnapshot)
);

export default router;
