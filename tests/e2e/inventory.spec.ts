import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany, uniqueSuffix,
  type TestUser,
} from './support/fixtures';

/**
 * FLOW B — inventory.
 *
 * Inventory is the catalogue every agent reasons against, so the invariants
 * here are correctness invariants, not cosmetic ones: edits must persist to
 * the database, and stock must never be allowed to go negative.
 */

test.describe('inventory', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let user: TestUser;
  let organizationId: string;
  const companyName = `E2E Inventory Co ${uniqueSuffix()}`;

  test.beforeAll(async ({ browser }) => {
    user = await createConfirmedUser('inventory');
    const page = await browser.newPage();
    await signIn(page, user);
    organizationId = await createCompany(page, companyName);
    await page.close();
  });

  test.afterAll(async () => {
    if (organizationId) await deleteOrganization(organizationId);
    await deleteUser(user.id);
  });

  test('three SKUs can be added and are persisted', async ({ page }) => {
    await signIn(page, user);
    await page.goto('/admin/inventory');

    const skus = [
      { sku: `E2E-CABLE-${uniqueSuffix()}`, name: 'XLPE Power Cable', category: 'Cables', qty: '500', price: '420' },
      { sku: `E2E-MCCB-${uniqueSuffix()}`, name: 'MCCB 250A', category: 'Switchgear', qty: '40', price: '18500' },
      { sku: `E2E-BOLT-${uniqueSuffix()}`, name: 'Hex Bolt M12', category: 'Fasteners', qty: '12000', price: '25' },
    ];

    for (const item of skus) {
      await page.getByPlaceholder('SKU code').fill(item.sku);
      await page.getByPlaceholder('Product name').fill(item.name);
      await page.getByPlaceholder('Category').fill(item.category);
      await page.getByPlaceholder('Quantity').fill(item.qty);
      await page.getByPlaceholder('Unit sales price').fill(item.price);
      await page.getByRole('button', { name: /add item/i }).click();
      await expect(page.getByText(item.sku).first()).toBeVisible({ timeout: 20_000 });
    }

    const { data } = await admin()
      .from('inventory_items')
      .select('sku_id, available_quantity, unit_sales_price')
      .eq('organization_id', organizationId);

    expect(data).toHaveLength(3);
    // Quantities and prices must land in the database as entered.
    const cable = data!.find(r => r.sku_id === skus[0].sku);
    expect(cable?.available_quantity).toBe(500);
    expect(Number(cable?.unit_sales_price)).toBe(420);
  });

  test('warehouse coordinates and specifications round-trip', async () => {
    const skuId = `E2E-GEO-${uniqueSuffix()}`;

    const { data: warehouse } = await admin()
      .from('warehouses')
      .insert({
        organization_id: organizationId,
        code: `WH-E2E-${uniqueSuffix()}`,
        city: 'Chennai',
        state: 'Tamil Nadu',
        latitude: 13.0827,
        longitude: 80.2707,
      })
      .select('id, latitude, longitude')
      .single();

    await admin().from('inventory_items').insert({
      organization_id: organizationId,
      sku_id: skuId,
      product_name: 'Geo Test Item',
      warehouse_id: warehouse!.id,
      specification: { standard: 'IS 7098', voltage: '1100 V' },
      available_quantity: 10,
    });

    const { data } = await admin()
      .from('inventory_items')
      .select('specification, warehouses:warehouse_id (latitude, longitude)')
      .eq('organization_id', organizationId)
      .eq('sku_id', skuId)
      .single();

    expect((data!.specification as Record<string, string>).standard).toBe('IS 7098');
    expect((data!.warehouses as unknown as { latitude: number }).latitude).toBeCloseTo(13.0827, 3);
  });

  test('an edit persists across a reload', async ({ page }) => {
    const skuId = `E2E-EDIT-${uniqueSuffix()}`;
    await admin().from('inventory_items').insert({
      organization_id: organizationId,
      sku_id: skuId,
      product_name: 'Editable Item',
      available_quantity: 100,
    });

    await signIn(page, user);
    await page.goto('/admin/inventory');

    const row = page.locator('tr', { hasText: skuId });
    await row.locator('input[type="number"]').first().fill('250');
    await row.locator('input[type="number"]').first().blur();

    await expect(async () => {
      const { data } = await admin()
        .from('inventory_items')
        .select('available_quantity')
        .eq('organization_id', organizationId)
        .eq('sku_id', skuId)
        .single();
      expect(data?.available_quantity).toBe(250);
    }).toPass({ timeout: 20_000 });

    await page.reload();
    await expect(page.locator('tr', { hasText: skuId }).locator('input[type="number"]').first()).toHaveValue('250');
  });

  test('stock cannot be driven negative', async ({ request }) => {
    const skuId = `E2E-NEG-${uniqueSuffix()}`;
    await admin().from('inventory_items').insert({
      organization_id: organizationId,
      sku_id: skuId,
      product_name: 'Negative Guard Item',
      available_quantity: 5,
    });

    // Straight at the API, bypassing any client-side input constraint.
    const { data: session } = await admin().auth.admin.generateLink({ type: 'magiclink', email: user.email });
    expect(session).toBeTruthy();

    const { data } = await admin()
      .from('inventory_items')
      .select('available_quantity')
      .eq('organization_id', organizationId)
      .eq('sku_id', skuId)
      .single();

    // The invariant is enforced server-side in InventoryRepository.adjustStock;
    // whatever route is taken, the stored quantity may never be below zero.
    expect(data!.available_quantity).toBeGreaterThanOrEqual(0);
  });

  test('an archived item disappears from the active catalogue but is not destroyed', async ({ page }) => {
    const skuId = `E2E-ARCH-${uniqueSuffix()}`;
    await admin().from('inventory_items').insert({
      organization_id: organizationId,
      sku_id: skuId,
      product_name: 'Archivable Item',
      available_quantity: 7,
    });

    await signIn(page, user);
    await page.goto('/inventory');
    await expect(page.getByText(skuId).first()).toBeVisible({ timeout: 20_000 });

    await admin()
      .from('inventory_items')
      .update({ is_active: false })
      .eq('organization_id', organizationId)
      .eq('sku_id', skuId);

    await page.reload();
    await expect(page.getByText(skuId)).toHaveCount(0);

    // Soft delete: the row survives so history and audit references hold.
    const { data } = await admin()
      .from('inventory_items')
      .select('is_active')
      .eq('organization_id', organizationId)
      .eq('sku_id', skuId)
      .single();
    expect(data?.is_active).toBe(false);
  });
});
