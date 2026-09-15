import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import { env } from '../config/env';

/**
 * Server-side Supabase access.
 *
 * Two clients, with a deliberate default:
 *
 *   userClient(jwt)  — anon key + the caller's JWT. RLS applies. This is the
 *                      path for anything done on behalf of a signed-in user,
 *                      and it is what almost every request should use.
 *
 *   serviceClient()  — service-role key. BYPASSES RLS ENTIRELY. Only for
 *                      background work with no user in the loop. Every query
 *                      made through it must carry an explicit
 *                      organization_id predicate, because the database will
 *                      no longer enforce that for you.
 */

export const isSupabaseConfigured = Boolean(env.supabase.url && env.supabase.anonKey);
export const hasServiceRole = Boolean(env.supabase.serviceRoleKey);

export class SupabaseNotConfiguredError extends Error {
  constructor(what: string) {
    super(`Supabase is not configured: ${what}`);
    this.name = 'SupabaseNotConfiguredError';
  }
}

/**
 * RLS-enforced client scoped to one request's user.
 * The JWT is attached per-client so concurrent requests cannot bleed into
 * one another.
 */
export function userClient(accessToken: string): SupabaseClient<Database> {
  if (!isSupabaseConfigured) {
    throw new SupabaseNotConfiguredError('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  }
  return createClient<Database>(env.supabase.url, env.supabase.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let cachedServiceClient: SupabaseClient<Database> | null = null;

/**
 * Privileged client. Prefer userClient(). Throws rather than silently
 * degrading, so a missing key never turns into a security surprise.
 */
export function serviceClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured) {
    throw new SupabaseNotConfiguredError('SUPABASE_URL / SUPABASE_ANON_KEY missing');
  }
  if (!env.supabase.serviceRoleKey) {
    throw new SupabaseNotConfiguredError(
      'SUPABASE_SERVICE_ROLE_KEY is not set — privileged server operations are unavailable'
    );
  }
  if (!cachedServiceClient) {
    cachedServiceClient = createClient<Database>(env.supabase.url, env.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return cachedServiceClient;
}

/** Verifies a bearer token and returns the user id, or null. */
export async function verifyAccessToken(accessToken: string): Promise<{ id: string; email: string | null } | null> {
  if (!isSupabaseConfigured) return null;
  const client = userClient(accessToken);
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
