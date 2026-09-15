import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany, uniqueSuffix,
  type TestUser,
} from './support/fixtures';
import { createClient } from '@supabase/supabase-js';
import { E2E_ENV } from './support/fixtures';

/**
 * FLOW D and F — inviting a member, and accepting an invitation.
 *
 * The property that matters most: accepting an invitation must never confer
 * ownership, however the invitation row is crafted. Ownership is minted only
 * by creating an organisation.
 */

test.describe('organisation invitations', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let owner: TestUser;
  let invitee: TestUser;
  let organizationId: string;
  const companyName = `E2E Invite Co ${uniqueSuffix()}`;

  test.beforeAll(async ({ browser }) => {
    owner = await createConfirmedUser('inv-owner');
    invitee = await createConfirmedUser('inv-guest');

    const page = await browser.newPage();
    await signIn(page, owner);
    organizationId = await createCompany(page, companyName);
    await page.close();
  });

  test.afterAll(async () => {
    if (organizationId) await deleteOrganization(organizationId);
    await deleteUser(owner.id);
    await deleteUser(invitee.id);
  });

  test('an owner can invite someone from the admin screen', async ({ page }) => {
    await signIn(page, owner);
    await page.goto('/admin/users');

    await page.getByPlaceholder('name@company.com').fill(invitee.email);
    await page.getByRole('button', { name: /send invite/i }).click();

    await expect(page.getByText(invitee.email).first()).toBeVisible({ timeout: 20_000 });

    const { data } = await admin()
      .from('invitations')
      .select('email, role, status')
      .eq('organization_id', organizationId)
      .eq('email', invitee.email.toLowerCase())
      .single();

    expect(data?.status).toBe('pending');
    expect(data?.role).toBe('member');
  });

  test('the invited user sees the invitation on first sign-in', async ({ page }) => {
    await signIn(page, invitee);

    // No organisation yet, so the decision tree routes to onboarding — where
    // the pending invitation is offered ahead of creating a new workspace.
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByText(/you have been invited/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(companyName).first()).toBeVisible();
  });

  test('accepting the invitation creates the membership and opens the workspace', async ({ page }) => {
    await signIn(page, invitee);
    await page.waitForURL(/\/onboarding/);

    await page.getByRole('button', { name: /^join$/i }).first().click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    const { data: membership } = await admin()
      .from('organization_members')
      .select('role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', invitee.id)
      .single();

    expect(membership?.status).toBe('active');
    expect(membership?.role).toBe('member');

    const { data: invitation } = await admin()
      .from('invitations')
      .select('status, accepted_at')
      .eq('organization_id', organizationId)
      .eq('email', invitee.email.toLowerCase())
      .single();

    expect(invitation?.status).toBe('accepted');
    expect(invitation?.accepted_at).toBeTruthy();
  });

  test('an accepted invitation cannot be replayed', async () => {
    const client = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    await client.auth.signInWithPassword({ email: invitee.email, password: invitee.password });

    const { data: invitation } = await admin()
      .from('invitations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('email', invitee.email.toLowerCase())
      .single();

    // Already a member: the call succeeds idempotently rather than creating a
    // second membership row.
    const { error } = await client.rpc('accept_invitation', { p_invitation_id: invitation!.id });
    expect(error).toBeNull();

    const { count } = await admin()
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('user_id', invitee.id);

    expect(count).toBe(1);
  });

  test('an invitation addressed to someone else is invisible and unusable', async () => {
    const outsider = await createConfirmedUser('inv-outsider');

    try {
      const { data: fresh } = await admin()
        .from('invitations')
        .insert({
          organization_id: organizationId,
          email: `someone-else-${uniqueSuffix()}@tenderflow-e2e.com`,
          role: 'member',
          invited_by: owner.id,
          status: 'pending',
        })
        .select('id')
        .single();

      const client = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
      await client.auth.signInWithPassword({ email: outsider.email, password: outsider.password });

      // Not listed...
      const { data: listed } = await client.rpc('my_pending_invitations');
      expect((listed ?? []).some((i: { id: string }) => i.id === fresh!.id)).toBe(false);

      // ...and not acceptable, reported as "not found" rather than
      // "forbidden", so this cannot be used to discover who was invited.
      const { error } = await client.rpc('accept_invitation', { p_invitation_id: fresh!.id });
      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/not found/i);
    } finally {
      await deleteUser(outsider.id);
    }
  });

  test('an expired invitation is refused', async () => {
    const guest = await createConfirmedUser('inv-expired');

    try {
      const { data: expired } = await admin()
        .from('invitations')
        .insert({
          organization_id: organizationId,
          email: guest.email.toLowerCase(),
          role: 'member',
          invited_by: owner.id,
          status: 'pending',
          expires_at: new Date(Date.now() - 86_400_000).toISOString(),
        })
        .select('id')
        .single();

      const client = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
      await client.auth.signInWithPassword({ email: guest.email, password: guest.password });

      const { error } = await client.rpc('accept_invitation', { p_invitation_id: expired!.id });

      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/expired/i);

      const { count } = await admin()
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('user_id', guest.id);

      expect(count).toBe(0);
    } finally {
      await deleteUser(guest.id);
    }
  });

  test('an invitation marked OWNER never actually grants ownership', async () => {
    const guest = await createConfirmedUser('inv-escalate');

    try {
      // Craft the worst case directly in the database, bypassing the admin UI
      // entirely: a pending invitation whose role column says owner.
      const { data: crafted } = await admin()
        .from('invitations')
        .insert({
          organization_id: organizationId,
          email: guest.email.toLowerCase(),
          role: 'owner',
          invited_by: owner.id,
          status: 'pending',
        })
        .select('id')
        .single();

      const client = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
      await client.auth.signInWithPassword({ email: guest.email, password: guest.password });

      const { error } = await client.rpc('accept_invitation', { p_invitation_id: crafted!.id });
      expect(error).toBeNull();

      const { data: membership } = await admin()
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', guest.id)
        .single();

      // Downgraded to admin. Ownership comes only from creating a workspace.
      expect(membership?.role).not.toBe('owner');
      expect(membership?.role).toBe('admin');

      const { count: owners } = await admin()
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('role', 'owner');

      expect(owners).toBe(1);
    } finally {
      await deleteUser(guest.id);
    }
  });

  test('a revoked invitation is refused', async () => {
    const guest = await createConfirmedUser('inv-revoked');

    try {
      const { data: revoked } = await admin()
        .from('invitations')
        .insert({
          organization_id: organizationId,
          email: guest.email.toLowerCase(),
          role: 'member',
          invited_by: owner.id,
          status: 'revoked',
        })
        .select('id')
        .single();

      const client = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
      await client.auth.signInWithPassword({ email: guest.email, password: guest.password });

      const { error } = await client.rpc('accept_invitation', { p_invitation_id: revoked!.id });
      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/revoked/i);
    } finally {
      await deleteUser(guest.id);
    }
  });

  test('the invited member reaches the workspace but not the admin area', async ({ page }) => {
    await signIn(page, invitee);

    await page.goto('/inventory');
    await expect(page).not.toHaveURL(/\/signin/);

    await page.goto('/admin');
    await expect(page.getByText(/not available to your role/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
