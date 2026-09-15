import { withSupabase } from './db.mjs';
await withSupabase(async c => {
  const t = await c.query(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r'
    order by c.relname`);
  console.log('TABLE'.padEnd(36), 'RLS'.padEnd(6), 'POLICIES');
  console.log('-'.repeat(56));
  let unprotected = [];
  for (const r of t.rows) {
    console.log(r.table_name.padEnd(36), String(r.rls_enabled).padEnd(6), r.policies);
    if (r.table_name !== 'schema_migrations' && (!r.rls_enabled || r.policies === '0')) unprotected.push(r.table_name);
  }
  console.log('\ntables:', t.rows.length);
  console.log(unprotected.length ? '⚠️  UNPROTECTED: ' + unprotected.join(', ') : '✅ every business table has RLS + policies');
});
