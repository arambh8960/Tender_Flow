/**
 * Shared Postgres connection helper for migration and inspection scripts.
 *
 * Prefers SUPABASE_POOLER_URL (IPv4 session pooler). Falls back to
 * SUPABASE_DB_URL, repairing it when the password contains unescaped
 * reserved characters. Never logs credentials.
 */
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

function parseDsn(raw) {
  if (!raw) return null;
  const m = raw.match(/^(postgres(?:ql)?):\/\/(.*)@([^@]+)$/);
  if (!m) return null;
  const [, , userInfo, hostPart] = m;

  const sep = userInfo.indexOf(':');
  const user = decodeURIComponent(sep === -1 ? userInfo : userInfo.slice(0, sep));
  const password = decodeURIComponent(sep === -1 ? '' : userInfo.slice(sep + 1));

  const hostMatch = hostPart.match(/^([^:/]+)(?::(\d+))?(?:\/(.*))?$/);
  if (!hostMatch) return null;
  const [, host, port, database] = hostMatch;

  return {
    user,
    password,
    host,
    port: Number(port || 5432),
    database: (database || 'postgres').split('?')[0],
  };
}

export function supabaseConfig() {
  const cfg = parseDsn(process.env.SUPABASE_POOLER_URL) || parseDsn(process.env.SUPABASE_DB_URL);
  if (!cfg) {
    throw new Error('No usable Supabase DSN. Set SUPABASE_POOLER_URL in .env.');
  }
  return { ...cfg, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 };
}

/** Safe, credential-free description for logs. */
export function describeTarget() {
  const cfg = supabaseConfig();
  return `${cfg.host}:${cfg.port}/${cfg.database}`;
}

export async function withSupabase(fn) {
  const client = new Client(supabaseConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The legacy local Postgres the app used before Supabase. */
export async function withLegacy(fn) {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'tenderflow',
    password: String(process.env.DB_PASSWORD || ''),
    port: Number(process.env.DB_PORT) || 5432,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
