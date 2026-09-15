import {
  test, expect, E2E_READY, SKIP_REASON, admin, E2E_ENV,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany,
  seedInventory, uniqueSuffix, type TestUser,
} from './support/fixtures';
import { createClient } from '@supabase/supabase-js';

/**
 * FLOW F — the admin area and role enforcement.
 *
 * Two distinct things are checked. That an owner can see and use the admin
 * surface, and that a plain member cannot — not merely that the buttons are
 * hidden from them, but that the underlying APIs refuse. Hiding a control is
 * not a security boundary.
 */

test.describe('admin', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let owner: TestUser;
  let member: TestUser;
  let organizationId: string;

  test.beforeAll(async ({ browser }) => {
    owner = await createConfirmedUser('admin-owner');
    member = await createConfirmedUser('admin-member');

    const page = await browser.newPage();
    await signIn(page, owner);
    organizationId = await createCompany(page, `E2E Admin Co ${uniqueSuffix()}`);
    await page.close();

    // A second person joins the same company as a plain member.
    await admin().from('organization_members').insert({
      organization_id: organizationId,
      user_id: member.id,
      role: 'member',
      status: 'active',
    });

    await seedInventory(organizationId, [
      {
        sku_id: 'ADMIN-SKU-01',
        product_name: 'Admin Metric Item',
        product_category: 'Cables',
        available_quantity: 100,
        unit_sales_price: 250,
      },
      {
        sku_id: 'ADMIN-SKU-02',
        product_name: 'Admin Metric Item Two',
        product_category: 'Cables',
        available_quantity: 10,
        unit_sales_price: 1_000,
      },
    ]);
  });

  test.afterAll(async () => {
    if (organizationId) await deleteOrganization(organizationId);
    await deleteUser(owner.id);
    await deleteUser(member.id);
  });

  test('every admin section is reachable by the owner', async ({ page }) => {
    await signIn(page, owner);

    for (const [path, heading] of [
      ['/admin', /overview|active users/i],
      ['/admin/company', /company profile/i],
      ['/admin/users', /members|invite/i],
      ['/admin/inventory', /catalogue|add an item/i],
      ['/admin/compliance', /vault|upload/i],
      ['/admin/discovery', /discovery preferences/i],
      ['/admin/audit', /audit log/i],
    ] as const) {
      await page.goto(path);
      await expect(page.getByText(heading).first(), `"${path}" did not render`).toBeVisible({ timeout: 20_000 });
    }
  });

  test('overview metrics reflect real database values', async ({ page }) => {
    const { count: skuCount } = await admin()
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('is_active', true);

    await signIn(page, owner);
    await page.goto('/admin');

    // Inventory value = 100 x 250 + 10 x 1,000 = 35,000, computed from rows.
    await expect(page.getByText(String(skuCount)).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/35,000/).first()).toBeVisible();
  });

  test('the owner can change a member role', async ({ page }) => {
    await signIn(page, owner);
    await page.goto('/admin/users');

    const row = page.locator('tr', { hasText: member.email });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator('select').first().selectOption('manager');

    await expect(async () => {
      const { data } = await admin()
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', member.id)
        .single();
      expect(data?.role).toBe('manager');
    }).toPass({ timeout: 20_000 });

    // Put it back for the remaining assertions.
    await admin()
      .from('organization_members')
      .update({ role: 'member' })
      .eq('organization_id', organizationId)
      .eq('user_id', member.id);
  });

  test('a member is refused the admin area in the UI', async ({ page }) => {
    await signIn(page, member);
    await page.goto('/admin');

    await expect(page.getByText(/not available to your role/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a member sees no admin entry point', async ({ page }) => {
    await signIn(page, member);
    await page.goto('/dashboard');

    await expect(page.getByRole('button', { name: /^admin$/i })).toHaveCount(0);
  });

  test('a member is refused the admin APIs, not just the screens', async ({ request }) => {
    const asMember = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    const { data: session } = await asMember.auth.signInWithPassword({
      email: member.email,
      password: member.password,
    });

    const token = session.session!.access_token;
    const base = process.env.E2E_API_BASE_URL ?? 'http://localhost:3001';

    for (const path of ['/api/admin/overview', '/api/admin/members', '/api/admin/audit-logs']) {
      const response = await request.get(`${base}${path}?organizationId=${organizationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status(), `${path} was not refused for a member`).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe('INSUFFICIENT_ROLE');
    }
  });

  test('a member cannot read the audit log directly either', async () => {
    const asMember = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    await asMember.auth.signInWithPassword({ email: member.email, password: member.password });

    const { data } = await asMember.from('audit_logs').select('id').eq('organization_id', organizationId);

    // audit_logs SELECT is admin-only in RLS, so a member sees nothing.
    expect(data ?? []).toHaveLength(0);
  });

  test('the last owner cannot be demoted', async ({ request }) => {
    const asOwner = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    const { data: session } = await asOwner.auth.signInWithPassword({
      email: owner.email,
      password: owner.password,
    });

    const { data: membership } = await admin()
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', owner.id)
      .single();

    const base = process.env.E2E_API_BASE_URL ?? 'http://localhost:3001';
    const response = await request.put(`${base}/api/admin/members/${membership!.id}/role`, {
      headers: { Authorization: `Bearer ${session.session!.access_token}` },
      data: { organizationId, role: 'member' },
    });

    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe('LAST_OWNER');
  });
});
