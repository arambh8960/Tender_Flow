import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany,
  seedInventory, uniqueSuffix, type TestUser,
} from './support/fixtures';

/**
 * FLOW H — one person, two organisations.
 *
 * A user is not permanently bound to one company. They can own one workspace
 * and be a plain member of another, with different data and different rights
 * in each, and the active workspace is always explicit.
 */

test.describe('multiple organisation membership', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let user: TestUser;
  let hostOwner: TestUser;
  let ownedOrg: string;
  let guestOrg: string;

  const ownedName = `E2E Owned Co ${uniqueSuffix()}`;
  const guestName = `E2E Guest Co ${uniqueSuffix()}`;

  test.beforeAll(async ({ browser }) => {
    user = await createConfirmedUser('multi-user');
    hostOwner = await createConfirmedUser('multi-host');

    // The user creates their own workspace and owns it.
    const page = await browser.newPage();
    await signIn(page, user);
    ownedOrg = await createCompany(page, ownedName);
    await page.close();

    // A second company exists, owned by somebody else.
    const hostPage = await browser.newPage();
    await signIn(hostPage, hostOwner);
    guestOrg = await createCompany(hostPage, guestName);
    await hostPage.close();

    // ...and our user is a plain member of it.
    await admin().from('organization_members').insert({
      organization_id: guestOrg,
      user_id: user.id,
      role: 'member',
      status: 'active',
    });

    await seedInventory(ownedOrg, [
      { sku_id: 'OWNED-SKU-1', product_name: 'Owned Company Widget', available_quantity: 10, unit_sales_price: 100 },
    ]);
    await seedInventory(guestOrg, [
      { sku_id: 'GUEST-SKU-1', product_name: 'Guest Company Gadget', available_quantity: 20, unit_sales_price: 200 },
    ]);
  });

  test.afterAll(async () => {
    if (ownedOrg) await deleteOrganization(ownedOrg);
    if (guestOrg) await deleteOrganization(guestOrg);
    await deleteUser(user.id);
    await deleteUser(hostOwner.id);
  });

  test('both memberships exist with different roles', async () => {
    const { data } = await admin()
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id);

    expect(data).toHaveLength(2);
    expect(data!.find(m => m.organization_id === ownedOrg)?.role).toBe('owner');
    expect(data!.find(m => m.organization_id === guestOrg)?.role).toBe('member');
  });

  test('the switcher offers both organisations', async ({ page }) => {
    await signIn(page, user);
    await page.waitForURL(/\/dashboard/);

    await expect(page.getByText(/2 organisations/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('switching workspace changes which data is visible', async ({ page }) => {
    await signIn(page, user);
    await page.waitForURL(/\/dashboard/);

    // Open the switcher and choose the guest company.
    await page.getByText(/organisations?/i).first().click();
    await page.getByText(guestName).first().click();

    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');

    const guestBody = await page.locator('body').innerText();
    expect(guestBody).toContain('GUEST-SKU-1');
    expect(guestBody).not.toContain('OWNED-SKU-1');

    // Switch back.
    await page.getByText(/organisations?/i).first().click();
    await page.getByText(ownedName).first().click();

    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');

    const ownedBody = await page.locator('body').innerText();
    expect(ownedBody).toContain('OWNED-SKU-1');
    expect(ownedBody).not.toContain('GUEST-SKU-1');
  });

  test('admin rights follow the active organisation, not the person', async ({ page }) => {
    await signIn(page, user);
    await page.waitForURL(/\/dashboard/);

    // Owner of this one: admin is available.
    await page.goto('/admin');
    await expect(page.getByText(/overview|active users/i).first()).toBeVisible({ timeout: 20_000 });

    // Member of the other: it is not.
    await page.goto('/dashboard');
    await page.getByText(/organisations?/i).first().click();
    await page.getByText(guestName).first().click();

    await page.goto('/admin');
    await expect(page.getByText(/not available to your role/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the chosen workspace survives a reload', async ({ page }) => {
    await signIn(page, user);
    await page.waitForURL(/\/dashboard/);

    await page.getByText(/organisations?/i).first().click();
    await page.getByText(guestName).first().click();
    await page.waitForLoadState('networkidle');

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(guestName).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a user with no membership at all is sent to onboarding', async ({ browser }) => {
    const loner = await createConfirmedUser('multi-loner');
    const page = await browser.newPage();

    try {
      await signIn(page, loner);
      await expect(page).toHaveURL(/\/onboarding/);
      await expect(page.getByText(/create a new organisation/i).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.close();
      await deleteUser(loner.id);
    }
  });
});
