// server/index.ts — bootstrap only.
// Routes live in server/routes, handlers in server/controllers.
import 'dotenv/config';
import type { Server } from 'http';

import { createApp } from './app';
import { env, reportConfigStatus, assertProductionConfig } from './config/env';
import { isSupabaseConfigured } from './db/supabase';

/**
 * A process in an undefined state should not keep serving requests: both
 * handlers log and exit so the platform restarts a clean one.
 */
process.on('uncaughtException', err => {
  console.error('🔥 CRITICAL UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  console.error('🔥 UNHANDLED REJECTION:', reason);
  process.exit(1);
});

async function start() {
  reportConfigStatus();

  // In production a missing key is a deployment error, not a warning to be
  // discovered when the first request fails.
  if (env.isProduction) assertProductionConfig();

  if (!isSupabaseConfigured) {
    console.warn(
      '⚠️  Supabase is not configured. Authenticated endpoints will return 503 until SUPABASE_URL and SUPABASE_ANON_KEY are set.'
    );
  }

  const app = createApp();
  const server: Server = app.listen(env.port, () => {
    console.log(`🚀 TenderFlow API listening on port ${env.port} [${env.appEnv}]`);
  });

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests
   * finish, then exit. Without this, a deploy can cut off a discovery run or
   * an RFP analysis mid-write.
   */
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — draining connections...`);

    const forceTimer = setTimeout(() => {
      console.error('Shutdown timed out after 15s; exiting.');
      process.exit(1);
    }, 15_000);
    forceTimer.unref();

    server.close(err => {
      if (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
      console.log('✅ Shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void start();
