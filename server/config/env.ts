import 'dotenv/config';

/**
 * Centralised, validated environment access.
 *
 * Everything is read once here rather than through ad-hoc process.env lookups
 * scattered across handlers, where a missing key surfaced as an opaque
 * runtime failure deep inside a request.
 */

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function list(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return raw
    .split(',')
    .map(entry => entry.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

const appEnv = optional('APP_ENV', optional('NODE_ENV', 'development'));

export const env = {
  port: Number(optional('PORT', '3001')),
  appEnv,
  isProduction: appEnv === 'production',

  /**
   * Allowed browser origins. Development defaults cover Vite; production
   * must name its frontend explicitly — there is no wildcard fallback.
   */
  corsOrigins: list(
    'CORS_ORIGINS',
    appEnv === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173']
  ),

  supabase: {
    url: optional('SUPABASE_URL'),
    anonKey: optional('SUPABASE_ANON_KEY'),
    /** BYPASSES RLS. Server process only — never sent to a browser. */
    serviceRoleKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
  },

  ai: {
    geminiKeys: [optional('GEMINI_API_KEY'), optional('GEMINI_API_KEY_2')].filter(Boolean),
    groqKey: optional('GROQ_API_KEY'),
  },

  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
  },

  convertApiSecret: optional('CONVERT_API_SECRET'),

  puppeteer: {
    /** Headless everywhere unless explicitly disabled for local debugging. */
    headless: optional('PUPPETEER_HEADLESS', 'true') !== 'false',
    executablePath: optional('PUPPETEER_EXECUTABLE_PATH') || undefined,
    navigationTimeoutMs: Number(optional('PUPPETEER_NAV_TIMEOUT_MS', '30000')),
  },

  maps: {
    provider: optional('MAPS_PROVIDER', 'none'),
    apiKey: optional('MAPS_API_KEY'),
  },
};

export { required };

/**
 * Reports configuration gaps at boot instead of at request time. Warns rather
 * than throws, so the app still starts for the features that are configured.
 */
export function reportConfigStatus(): void {
  const warn = (msg: string) => console.warn(`⚠️  [CONFIG] ${msg}`);

  if (!env.supabase.url) warn('SUPABASE_URL is not set — Supabase features are disabled.');
  if (!env.supabase.anonKey) warn('SUPABASE_ANON_KEY is not set.');
  if (!env.supabase.serviceRoleKey) {
    warn('SUPABASE_SERVICE_ROLE_KEY is not set — audit logging and vault security are disabled.');
  }
  if (env.ai.geminiKeys.length === 0) warn('No Gemini API key — RFP parsing will fail.');
  if (!env.ai.groqKey) warn('GROQ_API_KEY is not set — the copilot and ATC parsing will fail.');
  if (env.corsOrigins.length === 0) warn('CORS_ORIGINS is empty — no browser origin may call this API.');
}

/**
 * Production refuses to start misconfigured.
 *
 * Each of these is a real outage or a security hole rather than a degraded
 * feature: without CORS origins no browser can call the API at all, and
 * without the service role key the audit trail silently stops recording.
 */
export function assertProductionConfig(): void {
  const problems: string[] = [];

  if (!env.supabase.url) problems.push('SUPABASE_URL is required.');
  if (!env.supabase.anonKey) problems.push('SUPABASE_ANON_KEY is required.');
  if (!env.supabase.serviceRoleKey) problems.push('SUPABASE_SERVICE_ROLE_KEY is required.');
  if (env.corsOrigins.length === 0) problems.push('CORS_ORIGINS must name the production frontend origin.');
  if (env.corsOrigins.includes('*')) problems.push('CORS_ORIGINS must not contain a wildcard.');

  if (problems.length > 0) {
    console.error('❌ Refusing to start in production with an incomplete configuration:');
    for (const problem of problems) console.error(`   • ${problem}`);
    process.exit(1);
  }
}
