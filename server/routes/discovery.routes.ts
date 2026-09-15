import { Router } from 'express';
import { runDiscovery, listDiscoveryRuns, listSupportedPortals } from '../controllers/discovery.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireOrgMember } from '../middleware/auth';

const router = Router();

// Discovery mutates organisation data (runs, tenders, qualifications), so it
// requires manager or above — matching the database write policies.
router.post(
  '/discover',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('manager')),
  asyncHandler(runDiscovery)
);

router.get(
  '/discovery/runs',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(listDiscoveryRuns)
);

router.get('/discovery/portals', asyncHandler(listSupportedPortals));

export default router;
