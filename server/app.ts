import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import routes from './routes';
import { errorHandler, notFoundHandler, fail } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { globalLimiter } from './middleware/rateLimit';
import { env } from './config/env';
import { isSupabaseConfigured, hasServiceRole, userClient } from './db/supabase';

/**
 * Express application assembly. No route bodies, no bootstrap.
 */
export function createApp() {
  const app = express();

  // Behind a platform proxy (Render, Fly, Vercel), req.ip is the proxy
  // without this, which would make every rate-limit bucket the same key.
  app.set('trust proxy', 1);

  app.use(helmet({
    // The API serves JSON, not pages, so the restrictive defaults are fine;
    // CORP is relaxed because the SPA is served from a different origin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  /**
   * CORS is an allowlist, not `cors()`.
   *
   * The previous wide-open configuration let any website on the internet
   * issue authenticated requests from a victim's browser.
   */
  const allowedOrigins = env.corsOrigins;
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: same-origin, curl, or a server-to-server call.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS policy.`));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    })
  );

  app.use(requestContext);
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));
  app.use(globalLimiter);

  /* ── liveness ───────────────────────────────────────────────────────── */
  // Answers "is the process up". Deliberately does no I/O, so a database
  // blip cannot cause the platform to kill a healthy container.
  app.get('/api/health', (_req, res) =>
    res.json({
      success: true,
      data: { status: 'ok', uptime: Math.round(process.uptime()), environment: env.appEnv },
    })
  );

  /* ── readiness ──────────────────────────────────────────────────────── */
  // Answers "can this process serve traffic". Reports dependency status
  // without disclosing URLs, keys or versions.
  app.get('/api/ready', async (_req, res) => {
    const checks: Record<string, 'ok' | 'degraded' | 'unconfigured'> = {
      supabase: isSupabaseConfigured ? 'ok' : 'unconfigured',
      serviceRole: hasServiceRole ? 'ok' : 'unconfigured',
      ai: env.ai.geminiKeys.length > 0 ? 'ok' : 'unconfigured',
    };

    if (isSupabaseConfigured) {
      try {
        // An unauthenticated select: RLS returns nothing, which is exactly
        // the point — it proves reachability without reading tenant data.
        const probe = userClient('anonymous-readiness-probe');
        const { error } = await probe.from('organizations').select('id').limit(1);
        // An auth rejection still proves the service answered.
        checks.supabase = !error || error.message.toLowerCase().includes('jwt') ? 'ok' : 'degraded';
      } catch {
        checks.supabase = 'degraded';
      }
    }

    const ready = checks.supabase === 'ok';
    return res.status(ready ? 200 : 503).json({ success: ready, data: { ready, checks } });
  });

  app.use('/api', routes);

  app.use(notFoundHandler);

  // A CORS rejection is a 403, not the 500 the default error handler would
  // produce for a thrown Error.
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.message?.includes('not allowed by CORS policy')) {
      return fail(res, 403, 'ORIGIN_NOT_ALLOWED', 'This origin is not permitted to call the API.');
    }
    return errorHandler(err, req, res, next);
  });

  return app;
}
