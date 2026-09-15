import { Router } from 'express';
import {
  getVaultStatus,
  setPin,
  verifyPin,
  resetPin,
  disableVaultLock,
  pinSchema,
} from '../controllers/vaultSecurity.controller';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAuth, requireRecentAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimit';

/**
 * Session management itself lives in Supabase Auth and is handled directly
 * by the browser SDK — sign-in, OAuth, OTP and password reset never touch
 * this server. What remains is the optional vault lock, which always acts on
 * the authenticated caller's own record.
 *
 * Note the middleware order: authLimiter runs BEFORE requireAuth. Verifying a
 * bearer token costs a network round trip to Supabase, so an unauthenticated
 * flood would otherwise turn this server into an amplifier against our own
 * auth provider. The limiter is the cheap check and therefore goes first.
 */
const router = Router();

router.get('/vault/security', authLimiter, asyncHandler(requireAuth), asyncHandler(getVaultStatus));

router.post('/vault/pin', authLimiter, asyncHandler(requireAuth), validate(pinSchema), asyncHandler(setPin));

router.post(
  '/vault/pin/verify',
  authLimiter,
  asyncHandler(requireAuth),
  validate(pinSchema),
  asyncHandler(verifyPin)
);

/**
 * Forgotten PIN. Requires a recently-issued session, so the caller has just
 * re-verified through Supabase rather than relying on a months-old refreshed
 * token.
 */
router.post(
  '/vault/pin/reset',
  authLimiter,
  asyncHandler(requireAuth),
  requireRecentAuth(),
  validate(pinSchema),
  asyncHandler(resetPin)
);

router.delete('/vault/security', authLimiter, asyncHandler(requireAuth), asyncHandler(disableVaultLock));

export default router;
