import {
  test, expect, E2E_READY, SKIP_REASON, admin,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany,
  seedInventory, uniqueSuffix, type TestUser,
} from './support/fixtures';

/**
 * FLOW D — RFP processing and persistence.
 *
 * The central property: processing state lives in the database, so a refresh
 * mid-run rejoins the same record. The previous build kept it in React state,
 * where a reload lost the RFP, its status and every agent output.
 *
 * Running the full pipeline needs Gemini and Groq credentials. Where those
 * are absent these specs assert persistence and honest failure reporting
 * rather than pretending an analysis succeeded.
 */

test.describe('RFP pipeline', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let user: TestUser;
  let organizationId: string;

  test.beforeAll(async ({ browser }) => {
    user = await createConfirmedUser('rfp');
    const page = await browser.newPage();
    await signIn(page, user);
    organizationId = await createCompany(page, `E2E RFP Co ${uniqueSuffix()}`);
    await page.close();

    await seedInventory(organizationId, [
      {
        sku_id: 'RFP-CABLE-01',
        product_name: 'XLPE Armoured Power Cable 1100V',
        product_category: 'Cables',
        specification: { standard: 'IS 7098' },
        available_quantity: 5000,
        unit_sales_price: 420,
        cost_price: 350,
        gst_rate: 18,
      },
    ]);
  });

  test.afterAll(async () => {
    if (organizationId) await deleteOrganization(organizationId);
    await deleteUser(user.id);
  });

  test('the RFP list starts empty with a prompt to act', async ({ page }) => {
    await signIn(page, user);
    await page.goto('/rfps');

    await expect(page.getByText(/no tenders analysed yet/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a persisted analysis survives a reload at every stage', async ({ page }) => {
    await signIn(page, user);

    for (const status of ['Pending', 'Parsing', 'Processing', 'Complete'] as const) {
      const { data: analysis } = await admin()
        .from('tender_analyses')
        .insert({
          organization_id: organizationId,
          title: `E2E ${status} Tender`,
          buyer: 'E2E Buyer',
          source: 'File',
          status,
          created_by: user.id,
          ...(status === 'Complete'
            ? {
                parsed_data: { metadata: { bidNumber: 'GEM/E2E/1' }, products: [] },
                technical_analysis: { itemAnalyses: [] },
                pricing: { breakdown: { finalValue: 1000 } },
                risk_analysis: [],
                processing_seconds: 12,
              }
            : {}),
        })
        .select('id')
        .single();

      await page.goto(`/rfps/${analysis!.id}`);
      await page.waitForLoadState('networkidle');

      await page.reload();
      await page.waitForLoadState('networkidle');

      const { data: after } = await admin()
        .from('tender_analyses')
        .select('status')
        .eq('id', analysis!.id)
        .single();

      // The status must come back from the database unchanged by a reload.
      expect(after?.status, `status changed across reload at ${status}`).toBe(status);
      await expect(page).not.toHaveURL(/\/signin/);
    }
  });

  test('a failed analysis reports the error and never claims success', async ({ page }) => {
    const { data: analysis } = await admin()
      .from('tender_analyses')
      .insert({
        organization_id: organizationId,
        title: 'E2E Failing Tender',
        source: 'URL',
        source_url: 'https://bidplus.gem.gov.in/showbidDocument/000000',
        status: 'Error',
        error_message: 'The tender document could not be retrieved.',
        created_by: user.id,
      })
      .select('id')
      .single();

    await admin().from('analysis_runs').insert({
      organization_id: organizationId,
      analysis_id: analysis!.id,
      status: 'Error',
      stage: 'failed',
      error_code: 'FETCH_FAILED',
      error_message: 'The tender document could not be retrieved.',
      completed_at: new Date().toISOString(),
      duration_ms: 2400,
    });

    await signIn(page, user);
    await page.goto(`/rfps/${analysis!.id}`);

    await expect(page.getByText(/analysis failed|could not be retrieved/i).first()).toBeVisible({ timeout: 20_000 });

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/analysis complete|completed successfully/i);
  });

  test('the run history records why a run failed', async () => {
    const { data } = await admin()
      .from('analysis_runs')
      .select('status, error_code, error_message, duration_ms')
      .eq('organization_id', organizationId)
      .eq('status', 'Error')
      .limit(1)
      .single();

    expect(data?.error_code).toBe('FETCH_FAILED');
    expect(data?.error_message).toBeTruthy();
    expect(data?.duration_ms).toBeGreaterThan(0);
  });

  test('a completed analysis still shows its stored outputs after a reload', async ({ page }) => {
    const { data: analysis } = await admin()
      .from('tender_analyses')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('status', 'Complete')
      .limit(1)
      .single();

    await signIn(page, user);
    await page.goto(`/rfps/${analysis!.id}`);
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page).not.toHaveURL(/\/signin/);
    await expect(page.getByText(/tender|analysis|commercial/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('another company cannot open this company RFP by id', async ({ browser }) => {
    const { data: analysis } = await admin()
      .from('tender_analyses')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
      .single();

    const outsider = await createConfirmedUser('rfp-outsider');
    const page = await browser.newPage();
    let otherOrg: string | null = null;

    try {
      await signIn(page, outsider);
      otherOrg = await createCompany(page, `E2E RFP Outsider ${uniqueSuffix()}`);

      await page.goto(`/rfps/${analysis!.id}`);
      await expect(page.getByText(/not found|no longer have access/i).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      if (otherOrg) await deleteOrganization(otherOrg);
      await page.close();
      await deleteUser(outsider.id);
    }
  });
});
