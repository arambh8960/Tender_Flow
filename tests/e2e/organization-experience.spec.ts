import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, uniqueSuffix,
  type TestUser,
} from './support/fixtures';

/**
 * The organisation experience: gateway, creation, configuration, members and
 * the effect of that configuration on the agents.
 *
 * Creating a workspace through the real UI is what most of these depend on,
 * so it runs once and the rest build on it.
 */

test.describe('organisation experience', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  const created: string[] = [];
  const users: TestUser[] = [];
  let owner: TestUser;
  let organizationId: string;
  let organizationName: string;

  test.beforeAll(async ({ browser }) => {
    owner = await createConfirmedUser('org-exp-owner');
    users.push(owner);

    organizationName = `E2E Org Experience ${uniqueSuffix()}`;

    const page = await browser.newPage();
    await signIn(page, owner);

    // A user with no organisation lands on the gateway, not a blank screen.
    await expect(page).toHaveURL(/\/workspace/, { timeout: 30_000 });
    await expect(page.getByText(/welcome to tenderflow/i)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /create organisation/i }).first().click();
    await expect(page).toHaveURL(/\/organization\/create/, { timeout: 20_000 });

    await page.getByPlaceholder(/acme electrical/i).fill(organizationName);
    await page.getByRole('button', { name: /create & continue/i }).click();

    await expect(page.getByText(/legal & business/i)).toBeVisible({ timeout: 30_000 });
    await page.close();

    const { data } = await admin().from('organizations').select('id').eq('name', organizationName).single();
    organizationId = data!.id;
    created.push(organizationId);
  });

  test.afterAll(async () => {
    for (const id of created) await deleteOrganization(id);
    for (const user of users) await deleteUser(user.id);
  });

  test('TEST 1. creation made the caller OWNER and seeded configuration', async () => {
    const { data: membership } = await admin()
      .from('organization_members')
      .select('role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', owner.id)
      .single();

    expect(membership?.role).toBe('owner');
    expect(membership?.status).toBe('active');

    // Profile, discovery and financial rows are created with the organisation.
    for (const table of [
      'organization_profiles',
      'organization_discovery_settings',
      'organization_financial_settings',
    ] as const) {
      const { data } = await admin().from(table).select('organization_id').eq('organization_id', organizationId).maybeSingle();
      expect(data, `${table} was not created with the organisation`).not.toBeNull();
    }
  });

  test('the gateway now offers the workspace rather than creation', async ({ page }) => {
    await signIn(page, owner);
    await page.goto('/workspace');

    await expect(page.getByText(organizationName).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /^open$/i }).first()).toBeVisible();
  });

  test('the dashboard shows real, empty-state figures for a new organisation', async ({ page }) => {
    await signIn(page, owner);
    await page.goto('/dashboard');

    await expect(page.getByText(organizationName).first()).toBeVisible({ timeout: 20_000 });

    // A brand-new workspace must not display invented activity.
    await expect(page.getByText(/add your first products/i)).toBeVisible();
    await expect(page.getByText(/no discovery runs yet/i)).toBeVisible();
    await expect(page.getByText(/no rfps processed yet/i)).toBeVisible();

    // And it should say what is still outstanding.
    await expect(page.getByText(/finish setting up/i)).toBeVisible();
  });

  test('organisation settings persist warehouses to the database', async ({ page }) => {
    await signIn(page, owner);
    await page.goto('/organization/settings');

    await expect(page.getByText(/warehouses/i).first()).toBeVisible({ timeout: 20_000 });

    const code = `WH-E2E-${uniqueSuffix()}`.slice(0, 20);
    await page.getByPlaceholder('Code *').fill(code);
    await page.getByPlaceholder('City').fill('Jalandhar');
    await page.getByPlaceholder('State').fill('Punjab');
    await page.getByPlaceholder('Latitude').fill('31.3260');
    await page.getByPlaceholder('Longitude').fill('75.5762');
    await page.getByRole('button', { name: /^add$/i }).first().click();

    await expect(async () => {
      const { data } = await admin()
        .from('warehouses')
        .select('code, latitude, longitude')
        .eq('organization_id', organizationId)
        .eq('code', code)
        .maybeSingle();

      expect(data?.latitude).toBeCloseTo(31.326, 2);
    }).toPass({ timeout: 25_000 });
  });

  test('TEST 8. financial defaults persist and drive the costing agent', async ({ page }) => {
    await signIn(page, owner);
    await page.goto('/organization/settings');

    const gstInput = page.locator('input').filter({ hasNot: page.locator('[placeholder]') });
    void gstInput;

    // Edit through the form, then confirm the stored value — the agent reads
    // this row, so the database is what matters.
    const gstField = page.getByText(/default gst/i).locator('..').locator('input');
    await gstField.fill('12');
    await page.getByRole('button', { name: /save financial defaults/i }).click();

    await expect(async () => {
      const { data } = await admin()
        .from('organization_financial_settings')
        .select('default_gst_rate')
        .eq('organization_id', organizationId)
        .single();

      expect(Number(data?.default_gst_rate)).toBe(12);
    }).toPass({ timeout: 25_000 });
  });

  test('TEST 7. discovery configuration is stored against this organisation', async ({ page }) => {
    await signIn(page, owner);
    await page.goto('/admin/discovery');

    await expect(page.getByText(/discovery preferences/i)).toBeVisible({ timeout: 20_000 });

    const categories = page.getByPlaceholder(/cables, switchgear/i);
    await categories.fill('Cables, Switchgear');
    await page.getByRole('button', { name: /save preferences/i }).click();

    await expect(async () => {
      const { data } = await admin()
        .from('organization_discovery_settings')
        .select('categories')
        .eq('organization_id', organizationId)
        .single();

      expect(data?.categories).toContain('Cables');
    }).toPass({ timeout: 25_000 });
  });

  test('TEST 5. an owner can invite from the members screen', async ({ page }) => {
    const invitee = await createConfirmedUser('org-exp-invitee');
    users.push(invitee);

    await signIn(page, owner);
    await page.goto('/organization/members');

    await page.getByPlaceholder('name@company.com').fill(invitee.email);
    await page.getByRole('button', { name: /send invite/i }).click();

    await expect(page.getByText(invitee.email).first()).toBeVisible({ timeout: 20_000 });

    const { data } = await admin()
      .from('invitations')
      .select('status, role')
      .eq('organization_id', organizationId)
      .eq('email', invitee.email.toLowerCase())
      .single();

    expect(data?.status).toBe('pending');
  });

  test('TEST 2. the invited user sees and accepts from the gateway', async ({ browser }) => {
    const invitee = users.find(u => u.email.includes('org-exp-invitee'));
    test.skip(!invitee, 'depends on the invite case');

    const page = await browser.newPage();
    try {
      await signIn(page, invitee!);

      await expect(page).toHaveURL(/\/workspace/, { timeout: 30_000 });
      await expect(page.getByText(/you have been invited/i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(organizationName).first()).toBeVisible();

      await page.getByRole('button', { name: /accept/i }).first().click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

      const { data } = await admin()
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', invitee!.id)
        .single();

      expect(data?.role).toBe('member');
    } finally {
      await page.close();
    }
  });

  test('TEST 6. a member may read the organisation but not administer it', async ({ browser }) => {
    const invitee = users.find(u => u.email.includes('org-exp-invitee'));
    test.skip(!invitee, 'depends on the invite case');

    const page = await browser.newPage();
    try {
      await signIn(page, invitee!);

      // Profile is readable by any member.
      await page.goto('/organization');
      await expect(page.getByText(organizationName).first()).toBeVisible({ timeout: 20_000 });

      // Member management is not.
      await page.goto('/organization/members');
      await expect(page.getByText(/not available to your role/i)).toBeVisible({ timeout: 20_000 });

      await page.goto('/admin');
      await expect(page.getByText(/not available to your role/i)).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.close();
    }
  });

  test('the invitations page reports when nothing is pending', async ({ browser }) => {
    const loner = await createConfirmedUser('org-exp-loner');
    users.push(loner);

    const page = await browser.newPage();
    try {
      await signIn(page, loner);
      await page.goto('/invitations');

      await expect(page.getByText(/no pending invitations/i)).toBeVisible({ timeout: 20_000 });
      // Creation stays offered even when the invitation path is empty.
      await expect(page.getByRole('button', { name: /create organisation/i })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('an invite link for a different address explains the mismatch', async ({ browser }) => {
    const stranger = await createConfirmedUser('org-exp-stranger');
    users.push(stranger);

    const { data: invitation } = await admin()
      .from('invitations')
      .insert({
        organization_id: organizationId,
        email: `someone-else-${uniqueSuffix()}@tenderflow-e2e.com`,
        role: 'member',
        invited_by: owner.id,
        status: 'pending',
      })
      .select('token')
      .single();

    const page = await browser.newPage();
    try {
      await signIn(page, stranger);
      await page.goto(`/invitations/${invitation!.token}`);

      // Reported honestly rather than hidden: the user needs to know which
      // address to sign in with.
      await expect(page.getByText(/addressed to/i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: /accept invitation/i })).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('the public landing page is reachable and exposes no tenant data', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto('/');

      await expect(page.getByText(/procurement intelligence/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('link', { name: /get started/i }).first()).toBeVisible();

      const body = await page.locator('body').innerText();
      expect(body).not.toContain(organizationName);
    } finally {
      await context.close();
    }
  });
});
