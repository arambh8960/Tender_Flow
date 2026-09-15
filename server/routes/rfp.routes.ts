import { Router } from 'express';
import {
  createAndProcessRfp,
  reprocessRfp,
  listRfps,
  getRfp,
  fetchRfpFromUrl,
  convertPdf,
  createRfpSchema,
  fetchUrlSchema,
  convertPdfSchema,
} from '../controllers/rfp.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireOrgMember } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aiLimiter, fetchLimiter } from '../middleware/rateLimit';

const router = Router();

// Creating and processing an RFP writes organisation data, so it needs
// manager or above — the same bar the database write policies enforce.
router.post(
  '/rfps',
  asyncHandler(requireAuth),
  validate(createRfpSchema),
  asyncHandler(requireOrgMember('manager')),
  aiLimiter,
  asyncHandler(createAndProcessRfp)
);

router.post(
  '/rfps/:analysisId/reprocess',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('manager')),
  aiLimiter,
  asyncHandler(reprocessRfp)
);

router.get('/rfps', asyncHandler(requireAuth), asyncHandler(requireOrgMember('viewer')), asyncHandler(listRfps));

router.get(
  '/rfps/:analysisId',
  asyncHandler(requireAuth),
  asyncHandler(requireOrgMember('viewer')),
  asyncHandler(getRfp)
);

// Outbound fetching: authenticated, tenant-scoped and rate limited, because
// this is the endpoint an attacker would aim at the internal network.
router.post(
  '/fetch-rfp-url',
  asyncHandler(requireAuth),
  validate(fetchUrlSchema),
  asyncHandler(requireOrgMember('viewer')),
  fetchLimiter,
  asyncHandler(fetchRfpFromUrl)
);

router.post(
  '/convert-pdf',
  asyncHandler(requireAuth),
  validate(convertPdfSchema),
  asyncHandler(requireOrgMember('viewer')),
  fetchLimiter,
  asyncHandler(convertPdf)
);

export default router;
