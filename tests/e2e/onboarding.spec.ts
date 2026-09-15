import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany, uniqueSuffix,
  type TestUser,
} from './support/fixtures';

/**
 * FLOW A — signup, company creation, and the empty workspace.
 *
 * The property that matters most here is the absence of data: a brand-new
 * company must start genuinely empty. The old build shipped one company's
 * inventory, GSTIN and tenders as application defaults, so every new tenant
 * saw someone else's business.
 */

test.describe('company onboarding', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let user: TestUser;
  let organizationId: string | null = null;
  const companyName = `E2E Onboarding Co ${uniqueSuffix()}`;

  test.beforeAll(async () => {
    user = await createConfirmedUser('onboarding');
  });

  test.afterAll(async () => {
    if (organizationId) await deleteOrganization(organizationId);
    await deleteUser(user.id);
  });

  test('a user with no company is routed to onboarding', async ({ page }) => {
    await signIn(page, user);
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test('creating a company makes the creator its OWNER', async ({ page }) => {
    await signIn(page, user);
    organizationId = await createCompany(page, companyName);

    const { data } = await admin()
      .from('organization_members')
      .select('role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single();

    expect(data?.role).toBe('owner');
    expect(data?.status).toBe('active');
  });

  test('the dashboard shows the new company, not a bundled one', async ({ page }) => {
    await signIn(page, user);
    await page.waitForURL(/\/dashboard/);

    await expect(page.getByText(companyName, { exact: false }).first()).toBeVisible();

    // The demo tenant that used to be compiled in must not appear anywhere.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/TenderFlow Industrial Systems/i);
    expect(body).not.toMatch(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]\b/); // a GSTIN
  });

  test('inventory starts empty with a setup prompt', async ({ page }) => {
    await signIn(page, user);
    await page.goto('/inventory');

    await expect(page.getByText(/catalogue is empty|no inventory|add inventory/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('the vault starts empty', async ({ page }) => {
    await signIn(page, user);
    await page.goto('/admin/compliance');

    await expect(page.getByText(/vault is empty|no document/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('discovery asks for setup before it will run', async ({ page }) => {
    await signIn(page, user);
    await page.goto('/discovery');

    // With no inventory there is nothing to qualify against, and the screen
    // must say so rather than returning an empty result list.
    await expect(page.getByText(/add inventory|configure|setup|required/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('the company persists across a reload', async ({ page }) => {
    await signIn(page, user);
    await page.waitForURL(/\/dashboard/);

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(companyName, { exact: false }).first()).toBeVisible();
  });

  test('company settings were initialised for the new tenant', async () => {
    const { data } = await admin()
      .from('organization_discovery_settings')
      .select('organization_id')
      .eq('organization_id', organizationId!)
      .maybeSingle();

    expect(data, 'discovery settings were not created with the organisation').not.toBeNull();
  });
});
