import { withSupabase } from './db.mjs';
await withSupabase(async c => {
  const a = await c.query(`
    select pid, state, wait_event_type, wait_event,
           left(coalesce(query,''), 90) as q,
           now() - state_change as idle_for
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
    order by state_change`);
  console.log('=== sessions ===');
  for (const r of a.rows) {
    console.log(`pid=${r.pid} state=${r.state} wait=${r.wait_event_type}/${r.wait_event} idle=${r.idle_for} :: ${r.q}`);
  }
  const b = await c.query(`
    select pid, left(query,80) q from pg_stat_activity
    where state = 'idle in transaction' and pid <> pg_backend_pid()`);
  if (b.rowCount) {
    console.log('\n=== terminating idle-in-transaction sessions ===');
    for (const r of b.rows) {
      await c.query('select pg_terminate_backend($1)', [r.pid]);
      console.log('terminated', r.pid);
    }
  } else {
    console.log('\nno idle-in-transaction sessions');
  }
});
