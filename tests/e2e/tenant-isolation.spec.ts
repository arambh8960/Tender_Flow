import {
  test, expect, E2E_READY, SKIP_REASON, admin, E2E_ENV,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany,
  seedInventory, uniqueSuffix, type TestUser,
} from './support/fixtures';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * FLOW G — tenant isolation. This is the release-blocking suite.
 *
 * Every assertion runs against the real database as a real signed-in user, so
 * what is being tested is Postgres RLS itself, not our own WHERE clauses. A
 * server-side filter that happened to be correct would still let a direct
 * PostgREST call through; RLS is what makes that impossible.
 */

interface Tenant {
  user: TestUser;
  organizationId: string;
  client: SupabaseClient;
  name: string;
}

async function signedInClient(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`Could not sign in the test user: ${error.message}`);
  return client;
}

test.describe('tenant isolation', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let a: Tenant;
  let b: Tenant;

  test.beforeAll(async ({ browser }) => {
    const build = async (label: string, company: string): Promise<Tenant> => {
      const user = await createConfirmedUser(label);
      const page = await browser.newPage();
      await signIn(page, user);
      const organizationId = await createCompany(page, company);
      await page.close();

      return { user, organizationId, client: await signedInClient(user), name: company };
    };

    a = await build('iso-a', `E2E Isolation A ${uniqueSuffix()}`);
    b = await build('iso-b', `E2E Isolation B ${uniqueSuffix()}`);

    // Deliberately distinct data on each side.
    await seedInventory(a.organizationId, [
      { sku_id: 'A-ONLY-CABLE', product_name: 'Company A Cable', available_quantity: 100, unit_sales_price: 400 },
    ]);
    await seedInventory(b.organizationId, [
      { sku_id: 'B-ONLY-MICROSCOPE', product_name: 'Company B Microscope', available_quantity: 5, unit_sales_price: 32000 },
    ]);

    for (const tenant of [a, b]) {
      await admin().from('tender_analyses').insert({
        organization_id: tenant.organizationId,
        title: `${tenant.name} RFP`,
        source: 'File',
        status: 'Complete',
        created_by: tenant.user.id,
      });

      await admin().from('discovery_runs').insert({
        organization_id: tenant.organizationId,
        portal: 'gem',
        status: 'completed',
        criteria: {},
      });

      await admin().from('compliance_documents').insert({
        organization_id: tenant.organizationId,
        cert_name: `${tenant.name} Certificate`,
        uploaded_by: tenant.user.id,
      });
    }
  });

  test.afterAll(async () => {
    for (const tenant of [a, b]) {
      if (tenant?.organizationId) await deleteOrganization(tenant.organizationId);
      if (tenant?.user) await deleteUser(tenant.user.id);
    }
  });

  const TABLES = [
    'inventory_items',
    'tender_analyses',
    'discovery_runs',
    'compliance_documents',
    'organization_members',
  ] as const;

  test('each tenant reads only its own rows', async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const table of TABLES) {
        const { data: own } = await self.client.from(table).select('organization_id');
        expect(own!.length, `${self.name} sees nothing in ${table}`).toBeGreaterThan(0);

        // Every visible row belongs to the caller's own organisation.
        for (const row of own!) {
          expect(row.organization_id, `${self.name} saw a foreign row in ${table}`).toBe(self.organizationId);
        }

        const { data: foreign } = await self.client
          .from(table)
          .select('id')
          .eq('organization_id', other.organizationId);

        expect(foreign ?? [], `${self.name} read ${other.name} rows from ${table}`).toHaveLength(0);
      }
    }
  });

  test('neither tenant can INSERT into the other', async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const { error } = await self.client.from('inventory_items').insert({
        organization_id: other.organizationId,
        sku_id: `INJECT-${uniqueSuffix()}`,
        product_name: 'Injected row',
        available_quantity: 1,
      });

      // The WITH CHECK clause is what stops a row being stamped with someone
      // else's organisation id.
      expect(error, `${self.name} inserted a row into ${other.name}`).toBeTruthy();
    }
  });

  test('neither tenant can UPDATE the other', async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const { data: before } = await admin()
        .from('inventory_items')
        .select('sku_id, product_name')
        .eq('organization_id', other.organizationId)
        .limit(1)
        .single();

      await self.client
        .from('inventory_items')
        .update({ product_name: 'HIJACKED' })
        .eq('organization_id', other.organizationId);

      const { data: after } = await admin()
        .from('inventory_items')
        .select('product_name')
        .eq('organization_id', other.organizationId)
        .eq('sku_id', before!.sku_id)
        .single();

      expect(after!.product_name, `${self.name} modified ${other.name} inventory`).toBe(before!.product_name);
    }
  });

  test('neither tenant can DELETE the other', async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const { count: before } = await admin()
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', other.organizationId);

      await self.client.from('inventory_items').delete().eq('organization_id', other.organizationId);

      const { count: after } = await admin()
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', other.organizationId);

      expect(after, `${self.name} deleted ${other.name} inventory`).toBe(before);
    }
  });

  test('neither tenant can read the other audit log', async () => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const { data } = await self.client.from('audit_logs').select('id').eq('organization_id', other.organizationId);
      expect(data ?? []).toHaveLength(0);
    }
  });

  test('an anonymous client reads nothing at all', async () => {
    const anon = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);

    for (const table of TABLES) {
      const { data } = await anon.from(table).select('id');
      expect(data ?? [], `anonymous access returned rows from ${table}`).toHaveLength(0);
    }
  });

  test('the UI shows each company only its own data', async ({ browser }) => {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const page = await browser.newPage();
      try {
        await signIn(page, self.user);
        await page.goto('/inventory');
        await page.waitForLoadState('networkidle');

        const body = await page.locator('body').innerText();
        expect(body, `${self.name} UI leaked ${other.name} data`).not.toContain(
          other.organizationId === a.organizationId ? 'A-ONLY-CABLE' : 'B-ONLY-MICROSCOPE'
        );
      } finally {
        await page.close();
      }
    }
  });

  test('direct navigation to the other company resource fails', async ({ browser }) => {
    const { data: rfpOfA } = await admin()
      .from('tender_analyses')
      .select('id')
      .eq('organization_id', a.organizationId)
      .limit(1)
      .single();

    const page = await browser.newPage();
    try {
      await signIn(page, b.user);
      await page.goto(`/rfps/${rfpOfA!.id}`);

      await expect(page.getByText(/not found|no longer have access/i).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.close();
    }
  });

  test('a suspended member loses access to their own company data', async () => {
    await admin()
      .from('organization_members')
      .update({ status: 'suspended' })
      .eq('organization_id', a.organizationId)
      .eq('user_id', a.user.id);

    try {
      // A fresh session so the change is not masked by a cached one.
      const suspended = await signedInClient(a.user);
      const { data } = await suspended.from('inventory_items').select('id');

      // is_org_member() requires status = 'active'.
      expect(data ?? [], 'a suspended member still read organisation data').toHaveLength(0);
    } finally {
      await admin()
        .from('organization_members')
        .update({ status: 'active' })
        .eq('organization_id', a.organizationId)
        .eq('user_id', a.user.id);
    }
  });
});
