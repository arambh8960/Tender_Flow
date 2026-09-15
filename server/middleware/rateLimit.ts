import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Rate limits for the endpoints that are expensive or attackable.
 *
 * Keyed by authenticated user when there is one, falling back to IP. Keying
 * on IP alone would let one signed-in user exhaust the budget for everyone
 * behind the same NAT, and would let a single user rotate IPs to bypass it.
 */
function userOrIpKey(req: Request): string {
  if (req.auth?.userId) return `user:${req.auth.userId}`;
  // ipKeyGenerator normalises IPv6 to a /64 so a single host cannot rotate
  // through its address space to reset the counter.
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

const shared = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
  },
};

/** Sign-in, OTP, PIN: credential-guessing surface. */
export const authLimiter = rateLimit({ ...shared, windowMs: 15 * 60_000, limit: 20 });

/** Discovery spawns a headless browser — the most expensive thing we do. */
export const discoveryLimiter = rateLimit({ ...shared, windowMs: 10 * 60_000, limit: 15 });

/** Uploads: bandwidth and storage cost. */
export const uploadLimiter = rateLimit({ ...shared, windowMs: 10 * 60_000, limit: 40 });

/** LLM-backed endpoints: per-request vendor cost. */
export const aiLimiter = rateLimit({ ...shared, windowMs: 10 * 60_000, limit: 60 });

/** Outbound fetching (SSRF surface) — deliberately tight. */
export const fetchLimiter = rateLimit({ ...shared, windowMs: 10 * 60_000, limit: 30 });

/** Blanket ceiling so no single caller can saturate the process. */
export const globalLimiter = rateLimit({ ...shared, windowMs: 60_000, limit: 300 });
