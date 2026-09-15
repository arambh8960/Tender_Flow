import { Router } from 'express';
import { copilotChat, marketInsights } from '../controllers/ai.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { aiLimiter } from '../middleware/rateLimit';

// Both endpoints spend vendor credit per call, so neither is anonymous any
// more and both are rate limited per user.
const router = Router();

router.post('/copilot-chat', asyncHandler(requireAuth), aiLimiter, asyncHandler(copilotChat));
router.get('/market-insights', asyncHandler(requireAuth), aiLimiter, asyncHandler(marketInsights));

export default router;
