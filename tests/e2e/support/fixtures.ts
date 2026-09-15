import { test as base, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * E2E support.
 *
 * These specs drive the real application against a real Supabase project.
 * That is deliberate: the flows worth testing end to end are exactly the ones
 * that depend on Auth, RLS and Storage, and a mocked session would prove
 * nothing about any of them.
 *
 * Users are created with the service role and pre-confirmed, because the
 * project requires email confirmation and no mailbox is reachable from CI.
 * Creating a confirmed user is an admin operation — it is NOT a bypass of the
 * auth check under test: the browser still signs in normally and still
 * receives a genuine JWT.
 */

export const E2E_ENV = {
  supabaseUrl: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
  anonKey:
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    '',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  /** Domain used for generated accounts; must pass Supabase's validator. */
  emailDomain: process.env.E2E_EMAIL_DOMAIN ?? 'tenderflow-e2e.com',
};

/** True when this machine can actually create users and read the database. */
export const E2E_READY = Boolean(E2E_ENV.supabaseUrl && E2E_ENV.anonKey && E2E_ENV.serviceRoleKey);

export const SKIP_REASON =
  'E2E requires VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY. ' +
  'See tests/e2e/README.md.';

export function admin(): SupabaseClient {
  if (!E2E_READY) throw new Error(SKIP_REASON);
  return createClient(E2E_ENV.supabaseUrl, E2E_ENV.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Unique per run, so parallel or repeated runs never collide. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;
}

/**
 * Creates a pre-confirmed user. Returns credentials the browser signs in with
 * through the normal UI.
 */
export async function createConfirmedUser(label: string): Promise<TestUser> {
  const email = `e2e-${label}-${uniqueSuffix()}@${E2E_ENV.emailDomain}`;
  const password = `E2e-Pass-${uniqueSuffix()}!`;

  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${label}` },
  });

  if (error) throw new Error(`Could not create the test user: ${error.message}`);
  return { id: data.user!.id, email, password };
}

/** Removes a user and everything cascading from them. */
export async function deleteUser(userId: string): Promise<void> {
  await admin().auth.admin.deleteUser(userId).catch(() => undefined);
}

/**
 * Deletes an organisation and its dependent rows.
 *
 * Test tenants must not accumulate in a shared project, and every business
 * table cascades from organizations, so removing the parent is sufficient.
 */
export async function deleteOrganization(organizationId: string): Promise<void> {
  await admin().from('organizations').delete().eq('id', organizationId);
}

/** Signs in through the real UI and waits for the app shell. */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/signin');

  await page.getByPlaceholder(/email/i).first().fill(user.email);

  // The gate offers a password path alongside the email-code path.
  const passwordToggle = page.getByRole('button', { name: /password/i }).first();
  if (await passwordToggle.isVisible().catch(() => false)) {
    await passwordToggle.click();
  }

  await page.getByPlaceholder(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign in|continue|log ?in/i }).first().click();

  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
}

/** Completes company onboarding and returns the new organisation id. */
export async function createCompany(page: Page, name: string): Promise<string> {
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

  await page.getByPlaceholder(/company|organisation|organization/i).first().fill(name);
  await page.getByRole('button', { name: /create|continue|get started/i }).first().click();

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  const { data } = await admin().from('organizations').select('id').eq('name', name).maybeSingle();
  if (!data) throw new Error(`Organisation "${name}" was not persisted`);
  return data.id as string;
}

/** Seeds inventory directly, for specs whose subject is not the add-item form. */
export async function seedInventory(
  organizationId: string,
  items: Array<Record<string, unknown>>
): Promise<void> {
  const { error } = await admin()
    .from('inventory_items')
    .insert(items.map(item => ({ organization_id: organizationId, ...item })));

  if (error) throw new Error(`Could not seed inventory: ${error.message}`);
}

export const test = base;
export { expect };
