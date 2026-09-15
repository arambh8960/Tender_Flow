import { withSupabase, withLegacy, describeTarget } from './db.mjs';

const TABLES = `
  select table_schema, table_name
  from information_schema.tables
  where table_schema not in ('pg_catalog','information_schema','pg_toast')
  order by table_schema, table_name`;

console.log('=== SUPABASE:', describeTarget(), '===');
await withSupabase(async c => {
  const t = await c.query(TABLES);
  const bySchema = {};
  for (const r of t.rows) (bySchema[r.table_schema] ??= []).push(r.table_name);
  for (const [s, names] of Object.entries(bySchema)) {
    console.log(`  ${s} (${names.length}): ${names.slice(0, 25).join(', ')}${names.length > 25 ? ' …' : ''}`);
  }
  const users = await c.query('select count(*)::int n from auth.users');
  console.log('  auth.users rows:', users.rows[0].n);
  const ext = await c.query("select extname from pg_extension order by 1");
  console.log('  extensions:', ext.rows.map(r => r.extname).join(', '));
});

console.log('\n=== LEGACY LOCAL POSTGRES ===');
try {
  await withLegacy(async c => {
    const t = await c.query(TABLES);
    for (const r of t.rows) {
      const cnt = await c.query(`select count(*)::int n from "${r.table_name}"`);
      const cols = await c.query(
        `select column_name, data_type from information_schema.columns
         where table_name=$1 order by ordinal_position`, [r.table_name]);
      console.log(`  ${r.table_name} — ${cnt.rows[0].n} rows`);
      console.log(`      ${cols.rows.map(x => x.column_name).join(', ')}`);
    }
  });
} catch (e) {
  console.log('  legacy DB unreachable:', e.code || e.message);
}
