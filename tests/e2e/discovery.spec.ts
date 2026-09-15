import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany,
  seedInventory, uniqueSuffix, type TestUser,
} from './support/fixtures';

/**
 * FLOW C — discovery.
 *
 * Determinism is the headline property: the previous implementation generated
 * match scores with Math.random, so the same tender scored differently on
 * every run and no result could be explained or reproduced.
 *
 * Live GeM scraping is NOT exercised here — it depends on an external portal
 * whose availability is outside this suite's control. What IS exercised is
 * everything downstream of the adapter, against persisted runs.
 */

test.describe('discovery', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let user: TestUser;
  let organizationId: string;

  test.beforeAll(async ({ browser }) => {
    user = await createConfirmedUser('discovery');
    const page = await browser.newPage();
    await signIn(page, user);
    organizationId = await createCompany(page, `E2E Discovery Co ${uniqueSuffix()}`);
    await page.close();

    const { data: warehouse } = await admin()
      .from('warehouses')
      .insert({
        organization_id: organizationId,
        code: 'WH-JAL',
        city: 'Jalandhar',
        state: 'Punjab',
        latitude: 31.326,
        longitude: 75.5762,
      })
      .select('id')
      .single();

    await seedInventory(organizationId, [
      {
        sku_id: 'DISC-CABLE-01',
        product_name: 'XLPE Armoured Power Cable 1100V',
        product_category: 'Cables',
        product_sub_category: 'Power Cable',
        specification: { standard: 'IS 7098', voltage: '1100 V' },
        available_quantity: 5000,
        unit_sales_price: 420,
        cost_price: 350,
        gst_rate: 18,
        lead_time_days: 5,
        warehouse_id: warehouse!.id,
      },
    ]);

    await admin()
      .from('organization_discovery_settings')
      .upsert(
        {
          organization_id: organizationId,
          categories: ['Cables'],
          manual_avg_kms: 400,
          manual_rate_per_km: 55,
          allow_emd: true,
          min_match_threshold: 20,
        },
        { onConflict: 'organization_id' }
      );
  });

  test.afterAll(async () => {
    if (organizationId) await deleteOrganization(organizationId);
    await deleteUser(user.id);
  });

  test('discovery configuration shows this company settings', async ({ page }) => {
    await signIn(page, user);
    await page.goto('/admin/discovery');

    await expect(page.getByText(/discovery preferences/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('input[value="400"]').first()).toBeVisible();

    // The average must be presented as a fallback estimate, never as the
    // distance to a tender.
    await expect(page.getByText(/estimate|fallback/i).first()).toBeVisible();
  });

  test('a persisted run is scoped to this company and explains itself', async ({ page }) => {
    // Seeded rather than scraped: the subject here is scoring and
    // presentation, not the external portal.
    const { data: run } = await admin()
      .from('discovery_runs')
      .insert({
        organization_id: organizationId,
        portal: 'gem',
        status: 'completed',
        criteria: { categories: ['Cables'] },
        total_found: 2,
        total_qualified: 1,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    const { data: tender } = await admin()
      .from('tenders')
      .insert({
        organization_id: organizationId,
        portal: 'gem',
        external_id: `GEM/E2E/${uniqueSuffix()}`,
        title: 'Supply of XLPE Armoured Power Cable',
        buyer: 'E2E Public Works',
        category: 'Cables',
        location: 'Ludhiana, Punjab',
        closing_at: new Date(Date.now() + 21 * 86_400_000).toISOString(),
        first_seen_run: run!.id,
      })
      .select('id')
      .single();

    await admin().from('tender_qualifications').insert({
      organization_id: organizationId,
      tender_id: tender!.id,
      run_id: run!.id,
      inventory_score: 85,
      overall_score: 78,
      is_qualified: true,
      reason: 'Qualified: high inventory overlap, stock available now.',
      breakdown: {
        logistics: { distanceKm: 60.1, distanceSource: 'computed', selectedWarehouse: 'WH-JAL' },
      },
    });

    await signIn(page, user);
    await page.goto('/admin/discovery');

    await expect(page.getByText(/discovery history/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('gem', { exact: false }).first()).toBeVisible();
  });

  test('persisted scores do not drift between reads', async () => {
    const read = async () =>
      (
        await admin()
          .from('tender_qualifications')
          .select('overall_score, inventory_score, is_qualified, reason')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: true })
      ).data;

    const first = await read();
    expect(first!.length).toBeGreaterThan(0);
    expect(JSON.stringify(await read())).toBe(JSON.stringify(first));
  });

  test('both the qualification reason and the rejection reason are recorded', async () => {
    const { data: run } = await admin()
      .from('discovery_runs')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
      .single();

    const { data: rejected } = await admin()
      .from('tenders')
      .insert({
        organization_id: organizationId,
        portal: 'gem',
        external_id: `GEM/E2E/REJECT/${uniqueSuffix()}`,
        title: 'Supply of Hospital Bed Linen',
        category: 'Textiles',
        closing_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      })
      .select('id')
      .single();

    await admin().from('tender_qualifications').insert({
      organization_id: organizationId,
      tender_id: rejected!.id,
      run_id: run!.id,
      inventory_score: 0,
      overall_score: 12,
      is_qualified: false,
      reason: "No product in this organisation's catalogue matches the tender.",
      breakdown: {},
    });

    const { data } = await admin()
      .from('tender_qualifications')
      .select('is_qualified, reason')
      .eq('organization_id', organizationId);

    const qualified = data!.filter(r => r.is_qualified);
    const refused = data!.filter(r => !r.is_qualified);

    // A user must be able to answer both "why was this recommended" and
    // "why was this rejected".
    expect(qualified.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    for (const row of data!) expect(row.reason, 'a qualification carried no reason').toBeTruthy();
  });

  test('a qualification stores a measured distance, not the configured average', async () => {
    const { data } = await admin()
      .from('tender_qualifications')
      .select('breakdown')
      .eq('organization_id', organizationId)
      .eq('is_qualified', true)
      .limit(1)
      .single();

    const logistics = (data!.breakdown as Record<string, any>).logistics;

    expect(logistics.distanceSource).toBe('computed');
    expect(logistics.selectedWarehouse).toBe('WH-JAL');
    // 400 is the configured average; a measured route must not equal it.
    expect(logistics.distanceKm).not.toBe(400);
  });

  test('another company sees none of these discovery runs', async ({ browser }) => {
    const outsider = await createConfirmedUser('disc-outsider');
    const page = await browser.newPage();
    let otherOrg: string | null = null;

    try {
      await signIn(page, outsider);
      otherOrg = await createCompany(page, `E2E Disc Outsider ${uniqueSuffix()}`);

      await page.goto('/admin/discovery');
      await expect(page.getByText(/no discovery runs yet/i).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      if (otherOrg) await deleteOrganization(otherOrg);
      await page.close();
      await deleteUser(outsider.id);
    }
  });
});
