/**
 * End-to-end tenant isolation through the real Supabase API.
 *
 * The RLS suite proves policies at the SQL level. This proves the same thing
 * through the path the browser actually uses: sign in over GoTrue, get a real
 * JWT, then query PostgREST with it. If anything between the token and the
 * policy is misconfigured, this is what catches it.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { admin, createTestUser, createTestOrg, cleanupTestData, disconnect } from '../helpers/rlsHarness.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PASSWORD = 'IsolationCheck!2026';

let userA, userB, orgA, orgB, tokenA, tokenB;

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `sign-in failed for ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

/** PostgREST query as a signed-in user. */
async function rest(token, path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

async function restWrite(token, path, method, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  await cleanupTestData();

  userA = await createTestUser('iso-a', PASSWORD);
  userB = await createTestUser('iso-b', PASSWORD);

  orgA = await createTestOrg(userA.id, 'Isolation A');
  orgB = await createTestOrg(userB.id, 'Isolation B');

  await admin(
    `insert into public.inventory_items (organization_id, sku_id, product_name, available_quantity)
     values ($1,'ISO-A-1','Org A Cable',10), ($2,'ISO-B-1','Org B Cable',10)`,
    [orgA.id, orgB.id]
  );

  tokenA = await signIn(userA.email);
  tokenB = await signIn(userB.email);
});

after(async () => {
  await cleanupTestData();
  await disconnect();
});

describe('Real JWT + PostgREST — each tenant sees only itself', () => {
  test('user A sees exactly one inventory row, its own', async () => {
    const { status, body } = await rest(tokenA, 'inventory_items?select=sku_id,organization_id');
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].sku_id, 'ISO-A-1');
    assert.equal(body[0].organization_id, orgA.id);
  });

  test('user B sees exactly one inventory row, its own', async () => {
    const { body } = await rest(tokenB, 'inventory_items?select=sku_id');
    assert.equal(body.length, 1);
    assert.equal(body[0].sku_id, 'ISO-B-1');
  });

  test('user A explicitly filtering for org B gets nothing', async () => {
    const { body } = await rest(tokenA, `inventory_items?organization_id=eq.${orgB.id}&select=sku_id`);
    assert.equal(body.length, 0);
  });

  test('user A sees only its own organization', async () => {
    const { body } = await rest(tokenA, 'organizations?select=id,name');
    assert.equal(body.length, 1);
    assert.equal(body[0].id, orgA.id);
  });

  test('user A cannot read org B members', async () => {
    const { body } = await rest(tokenA, `organization_members?organization_id=eq.${orgB.id}&select=id`);
    assert.equal(body.length, 0);
  });

  test('user A cannot insert into org B', async () => {
    const { status } = await restWrite(tokenA, 'inventory_items', 'POST', {
      organization_id: orgB.id,
      sku_id: 'SMUGGLED',
      product_name: 'Smuggled',
    });
    assert.ok(status === 401 || status === 403, `expected a rejection, got ${status}`);
  });

  test('user A cannot update org B inventory', async () => {
    const { body } = await restWrite(
      tokenA,
      `inventory_items?organization_id=eq.${orgB.id}`,
      'PATCH',
      { available_quantity: 999 }
    );
    assert.equal(Array.isArray(body) ? body.length : 0, 0);
  });

  test('user A cannot delete org B inventory', async () => {
    const { body } = await restWrite(tokenA, `inventory_items?organization_id=eq.${orgB.id}`, 'DELETE');
    assert.equal(Array.isArray(body) ? body.length : 0, 0);
    // and org B's row survives
    const { body: still } = await rest(tokenB, 'inventory_items?select=sku_id');
    assert.equal(still.length, 1);
  });

  test('the anon key alone reads nothing', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inventory_items?select=sku_id`, {
      headers: { apikey: ANON_KEY },
    });
    const body = await res.json().catch(() => null);
    if (res.status === 200) {
      assert.equal(body.length, 0, 'anonymous client read rows');
    } else {
      assert.ok(res.status === 401 || res.status === 403, `unexpected status ${res.status}`);
    }
  });
});

describe('Profile auto-provisioning', () => {
  test('a profile row exists for each new auth user', async () => {
    const { body } = await rest(tokenA, `profiles?id=eq.${userA.id}&select=id,full_name`);
    assert.equal(body.length, 1);
    assert.equal(body[0].id, userA.id);
  });
});
