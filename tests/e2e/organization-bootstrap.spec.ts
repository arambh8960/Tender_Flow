import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, uniqueSuffix,
  type TestUser,
} from './support/fixtures';

/**
 * Post-authentication bootstrap, in a real browser.
 *
 * The defect these cover: authentication succeeded and then the product never
 * appeared. A user who created an organisation stayed on the onboarding
 * screen, because nothing navigated them into the workspace and the route
 * they were on was outside the guard that would have noticed.
 */

test.describe('organisation bootstrap', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  const created: string[] = [];
  const users: TestUser[] = [];

  test.afterAll(async () => {
    for (const id of created) await deleteOrganization(id);
    for (const user of users) await deleteUser(user.id);
  });

  test('A/B. a new user is offered organisation creation and reaches the dashboard', async ({ page }) => {
    const user = await createConfirmedUser('bootstrap-new');
    users.push(user);

    await signIn(page, user);

    // Never a blank screen: a user with no organisation lands on onboarding.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    const createButton = page.getByRole('button', { name: /create a new organisation/i });
    await expect(createButton).toBeVisible({ timeout: 20_000 });

    await createButton.click();

    const name = `E2E Bootstrap Co ${uniqueSuffix()}`;
    await page.getByPlaceholder(/acme electrical/i).fill(name);
    await page.getByRole('button', { name: /^create$/i }).click();

    // Creation moves on to company details rather than stranding the user.
    await expect(page.getByText(/company details/i)).toBeVisible({ timeout: 30_000 });

    const { data: organization } = await admin()
      .from('organizations')
      .select('id')
      .eq('name', name)
      .single();
    created.push(organization!.id);

    // OWNER membership is created by the server, not requested by the client.
    const { data: membership } = await admin()
      .from('organization_members')
      .select('role, status')
      .eq('organization_id', organization!.id)
      .eq('user_id', user.id)
      .single();

    expect(membership?.role).toBe('owner');
    expect(membership?.status).toBe('active');

    // Skipping the optional steps must still deliver the workspace.
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: /skip for now/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('completing every step also lands on the dashboard', async ({ page }) => {
    const user = await createConfirmedUser('bootstrap-full');
    users.push(user);

    await signIn(page, user);
    await page.waitForURL(/\/onboarding/);
    await page.getByRole('button', { name: /create a new organisation/i }).click();

    const name = `E2E Full Onboarding ${uniqueSuffix()}`;
    await page.getByPlaceholder(/acme electrical/i).fill(name);
    await page.getByRole('button', { name: /^create$/i }).click();

    await expect(page.getByText(/company details/i)).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder(/registered entity name/i).fill(`${name} Private Limited`);
    await page.getByPlaceholder('22AAAAA0000A1Z5').fill('03AAAAA0000A1Z5');
    await page.getByRole('button', { name: /continue/i }).click();

    await expect(page.getByText(/procurement defaults/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /enter workspace/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    const { data: organization } = await admin().from('organizations').select('id').eq('name', name).single();
    created.push(organization!.id);

    const { data: profile } = await admin()
      .from('organization_profiles')
      .select('legal_name, gstin')
      .eq('organization_id', organization!.id)
      .single();

    expect(profile?.gstin).toBe('03AAAAA0000A1Z5');
  });

  test('C. an existing user with one organisation goes straight to the dashboard', async ({ page, browser }) => {
    const user = await createConfirmedUser('bootstrap-existing');
    users.push(user);

    // Give them a workspace first.
    const setup = await browser.newPage();
    await signIn(setup, user);
    await setup.waitForURL(/\/onboarding/);
    await setup.getByRole('button', { name: /create a new organisation/i }).click();

    const name = `E2E Existing Co ${uniqueSuffix()}`;
    await setup.getByPlaceholder(/acme electrical/i).fill(name);
    await setup.getByRole('button', { name: /^create$/i }).click();
    await expect(setup.getByText(/company details/i)).toBeVisible({ timeout: 30_000 });
    await setup.close();

    const { data: organization } = await admin().from('organizations').select('id').eq('name', name).single();
    created.push(organization!.id);

    // A fresh sign-in must not stop at onboarding.
    await signIn(page, user);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('F. a reload restores the session, the organisation and the workspace', async ({ page }) => {
    const user = users.find(u => u.email.includes('bootstrap-existing'));
    test.skip(!user, 'depends on the existing-user case');

    await signIn(page, user!);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page).not.toHaveURL(/\/signin|\/onboarding/);
  });

  test('onboarding is not reachable once a workspace exists', async ({ page }) => {
    const user = users.find(u => u.email.includes('bootstrap-existing'));
    test.skip(!user, 'depends on the existing-user case');

    await signIn(page, user!);
    await page.goto('/onboarding');

    // Redirected into the product rather than stranded on setup.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });

  test('the full TenderFlow product is present after bootstrap', async ({ page }) => {
    const user = users.find(u => u.email.includes('bootstrap-existing'));
    test.skip(!user, 'depends on the existing-user case');

    await signIn(page, user!);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // Authentication is the gateway, not the application.
    for (const [path, expected] of [
      ['/discovery', /discovery|inventory/i],
      ['/rfps', /tender|no tenders/i],
      ['/inventory', /catalogue|inventory/i],
      ['/settings', /settings|vault|company/i],
      ['/admin', /overview|active users/i],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      await expect(page, `${path} bounced to sign-in`).not.toHaveURL(/\/signin/);
      await expect(page.getByText(expected).first(), `${path} rendered nothing`).toBeVisible({ timeout: 20_000 });
    }
  });

  test('E. a user in several organisations is asked which workspace to open', async ({ page, browser }) => {
    const user = await createConfirmedUser('bootstrap-multi');
    users.push(user);

    const setup = await browser.newPage();
    await signIn(setup, user);
    await setup.waitForURL(/\/onboarding/);
    await setup.getByRole('button', { name: /create a new organisation/i }).click();

    const first = `E2E Multi One ${uniqueSuffix()}`;
    await setup.getByPlaceholder(/acme electrical/i).fill(first);
    await setup.getByRole('button', { name: /^create$/i }).click();
    await expect(setup.getByText(/company details/i)).toBeVisible({ timeout: 30_000 });
    await setup.close();

    const { data: firstOrg } = await admin().from('organizations').select('id').eq('name', first).single();
    created.push(firstOrg!.id);

    // A second workspace, joined as a plain member.
    const host = await createConfirmedUser('bootstrap-multi-host');
    users.push(host);

    const hostPage = await browser.newPage();
    await signIn(hostPage, host);
    await hostPage.waitForURL(/\/onboarding/);
    await hostPage.getByRole('button', { name: /create a new organisation/i }).click();

    const second = `E2E Multi Two ${uniqueSuffix()}`;
    await hostPage.getByPlaceholder(/acme electrical/i).fill(second);
    await hostPage.getByRole('button', { name: /^create$/i }).click();
    await expect(hostPage.getByText(/company details/i)).toBeVisible({ timeout: 30_000 });
    await hostPage.close();

    const { data: secondOrg } = await admin().from('organizations').select('id').eq('name', second).single();
    created.push(secondOrg!.id);

    await admin().from('organization_members').insert({
      organization_id: secondOrg!.id,
      user_id: user.id,
      role: 'member',
      status: 'active',
    });

    // A fresh browser context has no remembered choice, so the app must ask.
    const context = await browser.newContext();
    const fresh = await context.newPage();

    try {
      await signIn(fresh, user);

      await expect(fresh.getByText(/choose a workspace/i)).toBeVisible({ timeout: 30_000 });
      await expect(fresh.getByText(first)).toBeVisible();
      await expect(fresh.getByText(second)).toBeVisible();

      await fresh.getByText(second).click();
      await expect(fresh).toHaveURL(/\/dashboard/, { timeout: 30_000 });
      await expect(fresh.getByText(second, { exact: false }).first()).toBeVisible();
    } finally {
      await context.close();
    }

    void page;
  });
});
