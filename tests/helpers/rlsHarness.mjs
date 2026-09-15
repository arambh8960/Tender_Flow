/**
 * RLS test harness.
 *
 * Runs SQL as a specific end user by adopting the `authenticated` role and
 * setting the JWT claims Supabase's auth.uid() reads. This is how you
 * exercise policies without the Auth Admin API (and therefore without the
 * service-role key).
 *
 * Everything a test creates is namespaced with TEST_PREFIX and removed by
 * cleanupTestData(), so running against a live project stays safe.
 */
import pg from 'pg';
import { randomBytes } from 'crypto';
import { supabaseConfig } from '../../scripts/db.mjs';

const { Client } = pg;

/**
 * Fixture family shared by every suite, plus a per-process namespace.
 *
 * Node runs test FILES in parallel, so a shared prefix meant one suite's
 * cleanup deleted another suite's fixtures mid-run. Each process now owns its
 * own namespace and only cleans that, while still sweeping genuinely stale
 * rows left behind by a crashed run.
 */
export const TEST_PREFIX = 'tfrlstest';
export const RUN_ID = process.env.TF_TEST_RUN_ID || randomBytes(4).toString('hex');
export const TEST_NS = `${TEST_PREFIX}${RUN_ID}`;
export const TEST_EMAIL_DOMAIN = 'tfrlstest.invalid';

let client;

export async function connect() {
  if (client) return client;
  client = new Client(supabaseConfig());
  await client.connect();
  return client;
}

export async function disconnect() {
  if (client) {
    await client.end();
    client = null;
  }
}

/** Privileged query — runs as the migration/owner role, bypassing RLS. */
export async function admin(sql, params = []) {
  const c = await connect();
  return c.query(sql, params);
}

/**
 * Runs `fn` with the session impersonating `userId` as an authenticated
 * end user. Always rolls back, so tests never mutate shared state unless
 * they use admin() deliberately.
 */
export async function asUser(userId, sql, params = []) {
  const c = await connect();
  await c.query('begin');
  try {
    await c.query("select set_config('role', 'authenticated', true)");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
    ]);
    const result = await c.query(sql, params);
    return result;
  } finally {
    await c.query('rollback');
  }
}

/**
 * Same as asUser but COMMITS on success — for the few tests that must leave
 * a row behind for a later assertion.
 */
export async function asUserCommitted(userId, sql, params = []) {
  const c = await connect();
  await c.query('begin');
  try {
    await c.query("select set_config('role', 'authenticated', true)");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
    ]);
    const result = await c.query(sql, params);
    await c.query('commit');
    return result;
  } catch (err) {
    await c.query('rollback');
    throw err;
  }
}

/** Runs as an unauthenticated (anon) client. */
export async function asAnon(sql, params = []) {
  const c = await connect();
  await c.query('begin');
  try {
    await c.query("select set_config('role', 'anon', true)");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: 'anon', aud: 'anon' }),
    ]);
    return await c.query(sql, params);
  } finally {
    await c.query('rollback');
  }
}

/** Asserts that a statement is rejected (error) or affects/returns nothing. */
export async function expectDenied(runner, sql, params = []) {
  try {
    const res = await runner(sql, params);
    const rows = res.rowCount ?? res.rows?.length ?? 0;
    return { denied: rows === 0, rows, error: null };
  } catch (err) {
    return { denied: true, rows: 0, error: err.message };
  }
}

/**
 * Creates a confirmed auth user directly. The Auth Admin API would need the
 * service-role key; direct insert is the documented SQL-seeding path and is
 * sufficient because RLS reads only auth.uid().
 *
 * The empty-string token columns are load-bearing: GoTrue scans them into
 * non-nullable Go strings, so leaving them NULL makes every subsequent
 * sign-in for that user fail with "Database error querying schema".
 */
export async function createTestUser(label, password = 'test-password') {
  const email = `${TEST_NS}-${label}@${TEST_EMAIL_DOMAIN}`;
  const res = await admin(
    `insert into auth.users
       (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new,
        email_change, email_change_token_current, phone_change,
        phone_change_token, reauthentication_token)
     values
       ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated', 'authenticated', $1::text, crypt($3::text, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', $2::text),
        '', '', '', '', '', '', '', '')
     on conflict (id) do nothing
     returning id`,
    [email, `Test ${label}`, password]
  );
  return { id: res.rows[0].id, email };
}

/** Creates an organisation owned by `userId`, via the same RPC the app uses. */
export async function createTestOrg(userId, name) {
  const res = await asUserCommitted(userId, 'select * from public.create_organization($1, $2, $3)', [
    `${TEST_NS} ${name}`,
    null,
    'Electrical',
  ]);
  return res.rows[0];
}

export async function addMember(orgId, userId, role) {
  await admin(
    `insert into public.organization_members (organization_id, user_id, role, status)
     values ($1, $2, $3::org_role, 'active')
     on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active'`,
    [orgId, userId, role]
  );
}

/**
 * Removes this process's fixtures, plus any older than an hour left by a
 * crashed run. Never touches a concurrently running suite's namespace.
 */
export async function cleanupTestData() {
  await admin(`delete from public.organizations where name like $1 or slug like $2`, [
    `${TEST_NS}%`,
    `${TEST_NS}%`,
  ]);
  await admin(`delete from auth.users where email like $1`, [`${TEST_NS}-%@${TEST_EMAIL_DOMAIN}`]);

  await admin(
    `delete from public.organizations
     where (name like $1 or slug like $1) and created_at < now() - interval '1 hour'`,
    [`${TEST_PREFIX}%`]
  );
  await admin(
    `delete from auth.users
     where email like $1 and created_at < now() - interval '1 hour'`,
    [`%@${TEST_EMAIL_DOMAIN}`]
  );
}
