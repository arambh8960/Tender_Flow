import { Router } from 'express';
import {
  listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse,
  getFinancialSettings, updateFinancialSettings, getSetupProgress,
  warehouseSchema, warehouseUpdateSchema, financialSettingsSchema,
} from '../controllers/organizationConfig.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireOrgMember } from '../middleware/auth';
import { validate } from '../middleware/validate';

/**
 * Organisation configuration that the agents read: warehouses and financial
 * defaults. Reading needs membership; changing either needs manager or admin,
 * because both alter what every future bid is qualified and priced against.
 */
const router = Router();

router.get('/organization/warehouses', asyncHandler(requireAuth), asyncHandler(requireOrgMember('viewer')), asyncHandler(listWarehouses));

router.post(
  '/organization/warehouses',
  asyncHandler(requireAuth),
  validate(warehouseSchema),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(createWarehouse)
);

router.put(
  '/organization/warehouses/:warehouseId',
  asyncHandler(requireAuth),
  validate(warehouseUpdateSchema),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(updateWarehouse)
);

router.delete(
  '/organization/warehouses/:warehouseId',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(deleteWarehouse)
);

router.get(
  '/organization/financial-settings',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(getFinancialSettings)
);

// Commercial defaults change every bid, so editing them is admin-only.
router.put(
  '/organization/financial-settings',
  asyncHandler(requireAuth),
  validate(financialSettingsSchema),
  asyncHandler(requireOrgMember('admin')),
  asyncHandler(updateFinancialSettings)
);

router.get(
  '/organization/setup-progress',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(getSetupProgress)
);

export default router;
