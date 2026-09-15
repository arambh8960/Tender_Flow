import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../database.types';

/**
 * Browser Supabase client.
 *
 * Uses the publishable (anon) key ONLY. RLS is the enforcement boundary:
 * this client can reach the database, but every policy is evaluated against
 * the signed-in user's JWT.
 *
 * A service-role key must never appear here. Vite inlines every VITE_*
 * variable into the bundle, so anything readable from this file is readable
 * by anyone who opens devtools.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && publishableKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set. ' +
      'Authentication and organisation features are disabled.'
  );
}

// Guard against a service-role key being pasted into the publishable slot.
if (publishableKey && /service[_-]?role/i.test(publishableKey)) {
  throw new Error(
    '[supabase] VITE_SUPABASE_PUBLISHABLE_KEY looks like a service-role key. ' +
      'Service-role credentials must never reach the browser.'
  );
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://localhost:54321',
  publishableKey ?? 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'tenderflow.auth',
    },
  }
);

/** Current access token, for forwarding to the TenderFlow backend. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
