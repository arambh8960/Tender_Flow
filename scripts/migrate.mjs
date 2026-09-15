/**
 * Reproducible migration runner.
 *
 * Applies supabase/migrations/*.sql in filename order inside a transaction
 * each, recording applied files in public.schema_migrations so re-runs are
 * no-ops. Individual migrations are also written to be idempotent, so
 * `--force` can safely re-apply one.
 *
 *   node scripts/migrate.mjs              apply pending
 *   node scripts/migrate.mjs --status     show what is applied
 *   node scripts/migrate.mjs --force      re-apply everything
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { withSupabase, describeTarget } from './db.mjs';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

const TRACKING = `
create table if not exists public.schema_migrations (
  filename    text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now()
)`;

function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(filename => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      return {
        filename,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    });
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const statusOnly = args.includes('--status');

await withSupabase(async client => {
  console.log(`target: ${describeTarget()}\n`);
  await client.query(TRACKING);

  const applied = new Map(
    (await client.query('select filename, checksum from public.schema_migrations')).rows.map(r => [
      r.filename,
      r.checksum,
    ])
  );

  const migrations = loadMigrations();
  if (migrations.length === 0) {
    console.log('no migration files found');
    return;
  }

  if (statusOnly) {
    for (const m of migrations) {
      const prev = applied.get(m.filename);
      const state = !prev ? 'PENDING' : prev === m.checksum ? 'applied' : 'CHANGED SINCE APPLY';
      console.log(`  ${state.padEnd(20)} ${m.filename}`);
    }
    return;
  }

  let ran = 0;
  for (const m of migrations) {
    const prev = applied.get(m.filename);
    if (prev === m.checksum && !force) {
      console.log(`  skip     ${m.filename}`);
      continue;
    }
    if (prev && prev !== m.checksum) {
      console.log(`  changed  ${m.filename} (re-applying; migrations are idempotent)`);
    }

    process.stdout.write(`  apply    ${m.filename} ... `);
    try {
      await client.query('begin');
      await client.query(m.sql);
      await client.query(
        `insert into public.schema_migrations (filename, checksum)
         values ($1, $2)
         on conflict (filename) do update set checksum = excluded.checksum, applied_at = now()`,
        [m.filename, m.checksum]
      );
      await client.query('commit');
      console.log('ok');
      ran++;
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(`\n${err.message}\n`);
      if (err.position) {
        const pos = Number(err.position);
        console.error('near:', m.sql.slice(Math.max(0, pos - 200), pos + 200));
      }
      process.exit(1);
    }
  }

  console.log(`\n${ran} migration(s) applied.`);
});
