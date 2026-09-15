/**
 * Multi-tenant isolation matrix.
 *
 * The gate for "multi-tenancy is done". Every negative case here must fail
 * at the database, not at any application filter.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  admin,
  asUser,
  asAnon,
  createTestUser,
  createTestOrg,
  addMember,
  cleanupTestData,
  disconnect,
} from '../helpers/rlsHarness.mjs';

let userA, userB, userOutsider, viewer;
let orgA, orgB;
let skuA, skuB, tenderA, tenderB, runA;

before(async () => {
  await cleanupTestData();

  userA = await createTestUser('owner-a');
  userB = await createTestUser('owner-b');
  userOutsider = await createTestUser('outsider');
  viewer = await createTestUser('viewer-a');

  orgA = await createTestOrg(userA.id, 'Acme Electrical');
  orgB = await createTestOrg(userB.id, 'XYZ Infrastructure');

  await addMember(orgA.id, viewer.id, 'viewer');

  // Seed one row of each kind in both organisations, privileged.
  const seed = async (orgId, tag) => {
    const sku = await admin(
      `insert into public.inventory_items
         (organization_id, sku_id, product_name, product_category, available_quantity, unit_sales_price)
       values ($1, $2, $3, 'Cables', 100, 250) returning id`,
      [orgId, `${tag}-SKU-001`, `${tag} XLPE Cable`]
    );
    const run = await admin(
      `insert into public.discovery_runs (organization_id, portal, status, criteria)
       values ($1, 'gem', 'completed', '{"category":"cable"}'::jsonb) returning id`,
      [orgId]
    );
    const tender = await admin(
      `insert into public.tenders
         (organization_id, portal, external_id, title, buyer, first_seen_run)
       values ($1, 'gem', $2, $3, 'Test Buyer', $4) returning id`,
      [orgId, `${tag}-EXT-001`, `${tag} tender`, run.rows[0].id]
    );
    await admin(
      `insert into public.tender_qualifications
         (organization_id, tender_id, run_id, overall_score, is_qualified)
       values ($1, $2, $3, 87, true)`,
      [orgId, tender.rows[0].id, run.rows[0].id]
    );
    await admin(
      `insert into public.compliance_documents (organization_id, cert_name, category)
       values ($1, $2, 'TECHNICAL')`,
      [orgId, `${tag} ISO 9001:2015`]
    );
    return { sku: sku.rows[0].id, run: run.rows[0].id, tender: tender.rows[0].id };
  };

  const a = await seed(orgA.id, 'A');
  const b = await seed(orgB.id, 'B');
  skuA = a.sku; tenderA = a.tender; runA = a.run;
  skuB = b.sku; tenderB = b.tender;
});

after(async () => {
  await cleanupTestData();
  await disconnect();
});

// ── positive: a member sees their own organisation ────────────────────────
describe('User A within Organization A — allowed', () => {
  test('SELECT own inventory', async () => {
    const r = await asUser(userA.id, 'select id from public.inventory_items where organization_id = $1', [orgA.id]);
    assert.equal(r.rowCount, 1);
  });

  test('SELECT own tenders', async () => {
    const r = await asUser(userA.id, 'select id from public.tenders where organization_id = $1', [orgA.id]);
    assert.equal(r.rowCount, 1);
  });

  test('SELECT own discovery runs', async () => {
    const r = await asUser(userA.id, 'select id from public.discovery_runs where organization_id = $1', [orgA.id]);
    assert.equal(r.rowCount, 1);
  });

  test('SELECT own qualifications', async () => {
    const r = await asUser(userA.id, 'select id from public.tender_qualifications where organization_id = $1', [orgA.id]);
    assert.equal(r.rowCount, 1);
  });

  test('SELECT own compliance documents', async () => {
    const r = await asUser(userA.id, 'select id from public.compliance_documents where organization_id = $1', [orgA.id]);
    assert.equal(r.rowCount, 1);
  });

  test('INSERT own inventory', async () => {
    const r = await asUser(
      userA.id,
      `insert into public.inventory_items (organization_id, sku_id, product_name)
       values ($1, 'A-NEW-SKU', 'New Cable') returning id`,
      [orgA.id]
    );
    assert.equal(r.rowCount, 1);
  });

  test('UPDATE own tender', async () => {
    const r = await asUser(userA.id, `update public.tenders set title = 'edited' where id = $1 returning id`, [tenderA]);
    assert.equal(r.rowCount, 1);
  });

  test('sees own organization row', async () => {
    const r = await asUser(userA.id, 'select id from public.organizations where id = $1', [orgA.id]);
    assert.equal(r.rowCount, 1);
  });

  test('sees own enabled modules (8 seeded by default)', async () => {
    const r = await asUser(userA.id, 'select module_key from public.organization_modules where organization_id = $1', [orgA.id]);
    assert.equal(r.rowCount, 8);
  });
});

// ── negative: cross-tenant access must be impossible ──────────────────────
describe('User A against Organization B — denied', () => {
  test('SELECT B inventory returns nothing', async () => {
    const r = await asUser(userA.id, 'select id from public.inventory_items where organization_id = $1', [orgB.id]);
    assert.equal(r.rowCount, 0);
  });

  test('SELECT B inventory by primary key returns nothing (IDOR)', async () => {
    const r = await asUser(userA.id, 'select id from public.inventory_items where id = $1', [skuB]);
    assert.equal(r.rowCount, 0);
  });

  test('SELECT B tenders returns nothing', async () => {
    const r = await asUser(userA.id, 'select id from public.tenders where organization_id = $1', [orgB.id]);
    assert.equal(r.rowCount, 0);
  });

  test('SELECT B discovery runs returns nothing', async () => {
    const r = await asUser(userA.id, 'select id from public.discovery_runs where organization_id = $1', [orgB.id]);
    assert.equal(r.rowCount, 0);
  });

  test('SELECT B compliance documents returns nothing', async () => {
    const r = await asUser(userA.id, 'select id from public.compliance_documents where organization_id = $1', [orgB.id]);
    assert.equal(r.rowCount, 0);
  });

  test('UPDATE B tender affects 0 rows', async () => {
    const r = await asUser(userA.id, `update public.tenders set title = 'hacked' where id = $1 returning id`, [tenderB]);
    assert.equal(r.rowCount, 0);
  });

  test('DELETE B inventory affects 0 rows', async () => {
    const r = await asUser(userA.id, 'delete from public.inventory_items where id = $1 returning id', [skuB]);
    assert.equal(r.rowCount, 0);
  });

  test('INSERT stamped with B organization_id is rejected by WITH CHECK', async () => {
    await assert.rejects(
      () =>
        asUser(
          userA.id,
          `insert into public.inventory_items (organization_id, sku_id, product_name)
           values ($1, 'SMUGGLED', 'Smuggled Item')`,
          [orgB.id]
        ),
      /row-level security/i
    );
  });

  test('cannot move own row into B by UPDATE', async () => {
    await assert.rejects(
      () => asUser(userA.id, 'update public.inventory_items set organization_id = $1 where id = $2', [orgB.id, skuA]),
      /row-level security/i
    );
  });

  test('cannot read B organization row', async () => {
    const r = await asUser(userA.id, 'select id from public.organizations where id = $1', [orgB.id]);
    assert.equal(r.rowCount, 0);
  });

  test('cannot enumerate B members', async () => {
    const r = await asUser(userA.id, 'select id from public.organization_members where organization_id = $1', [orgB.id]);
    assert.equal(r.rowCount, 0);
  });

  test('cannot read B modules', async () => {
    const r = await asUser(userA.id, 'select module_key from public.organization_modules where organization_id = $1', [orgB.id]);
    assert.equal(r.rowCount, 0);
  });

  test('unqualified SELECT across all tenders returns only A', async () => {
    const r = await asUser(userA.id, 'select organization_id from public.tenders');
    assert.ok(r.rowCount >= 1);
    for (const row of r.rows) assert.equal(row.organization_id, orgA.id);
  });

  test('unqualified SELECT across all inventory returns only A', async () => {
    const r = await asUser(userA.id, 'select organization_id from public.inventory_items');
    assert.ok(r.rowCount >= 1);
    for (const row of r.rows) assert.equal(row.organization_id, orgA.id);
  });
});

// ── no membership at all ──────────────────────────────────────────────────
describe('User with no membership — denied everywhere', () => {
  test('sees no organizations', async () => {
    const r = await asUser(userOutsider.id, 'select id from public.organizations');
    assert.equal(r.rowCount, 0);
  });

  test('sees no inventory', async () => {
    const r = await asUser(userOutsider.id, 'select id from public.inventory_items');
    assert.equal(r.rowCount, 0);
  });

  test('sees no tenders', async () => {
    const r = await asUser(userOutsider.id, 'select id from public.tenders');
    assert.equal(r.rowCount, 0);
  });

  test('sees no discovery runs', async () => {
    const r = await asUser(userOutsider.id, 'select id from public.discovery_runs');
    assert.equal(r.rowCount, 0);
  });

  test('cannot insert into any organisation', async () => {
    await assert.rejects(
      () =>
        asUser(userOutsider.id, `insert into public.inventory_items (organization_id, sku_id, product_name)
                                 values ($1, 'X', 'X')`, [orgA.id]),
      /row-level security/i
    );
  });
});

// ── anonymous ─────────────────────────────────────────────────────────────
describe('Anonymous client — denied everywhere', () => {
  for (const table of [
    'organizations',
    'inventory_items',
    'tenders',
    'discovery_runs',
    'tender_qualifications',
    'compliance_documents',
    'organization_members',
    'profiles',
  ]) {
    test(`cannot read ${table}`, async () => {
      try {
        const r = await asAnon(`select * from public.${table} limit 5`);
        assert.equal(r.rowCount, 0, `anon read ${r.rowCount} rows from ${table}`);
      } catch (err) {
        assert.match(err.message, /permission denied|row-level security/i);
      }
    });
  }

  test('cannot read schema_migrations', async () => {
    try {
      const r = await asAnon('select * from public.schema_migrations limit 5');
      assert.equal(r.rowCount, 0);
    } catch (err) {
      assert.match(err.message, /permission denied|row-level security/i);
    }
  });
});
