/**
 * Generates database.types.ts from the live schema.
 *
 * Reproducible substitute for `supabase gen types` (the CLI is not installed
 * and the direct DB host is unreachable here). Run after every migration:
 *
 *   npm run db:types
 */
import fs from 'fs';
import path from 'path';
import { withSupabase, describeTarget } from './db.mjs';

const OUT = path.join(process.cwd(), 'database.types.ts');

const PG_TO_TS = {
  uuid: 'string',
  text: 'string',
  varchar: 'string',
  bpchar: 'string',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  numeric: 'number',
  float4: 'number',
  float8: 'number',
  bool: 'boolean',
  timestamptz: 'string',
  timestamp: 'string',
  date: 'string',
  jsonb: 'Json',
  json: 'Json',
};

function tsType(udtName, isArray) {
  const base = udtName.startsWith('_') ? udtName.slice(1) : udtName;
  const mapped = PG_TO_TS[base];
  const enumRef = mapped ? null : pascal(base);
  const t = mapped ?? enumRef ?? 'unknown';
  return isArray ? `${t}[]` : t;
}

const pascal = s => s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');

await withSupabase(async c => {
  console.log('reading schema from', describeTarget());

  const enums = await c.query(`
    select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname order by t.typname`);

  const cols = await c.query(`
    select c.table_name, c.column_name, c.is_nullable, c.column_default,
           c.data_type, c.udt_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.table_name <> 'schema_migrations'
    order by c.table_name, c.ordinal_position`);

  const funcs = await c.query(`
    select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_organization'`);

  const byTable = {};
  for (const r of cols.rows) (byTable[r.table_name] ??= []).push(r);

  let out = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: npm run db:types
 *
 * Mirrors the public schema of the Supabase project. Shared by the frontend
 * (src/services/supabase) and the server (server/db).
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

`;

  for (const e of enums.rows) {
    out += `export type ${pascal(e.typname)} = ${e.labels.map(l => `'${l}'`).join(' | ')};\n`;
  }
  out += '\n';

  out += 'export interface Database {\n  public: {\n    Tables: {\n';

  for (const [table, columns] of Object.entries(byTable)) {
    out += `      ${table}: {\n        Row: {\n`;
    for (const col of columns) {
      const nullable = col.is_nullable === 'YES';
      out += `          ${col.column_name}: ${tsType(col.udt_name, col.data_type === 'ARRAY')}${nullable ? ' | null' : ''};\n`;
    }
    out += '        };\n        Insert: {\n';
    for (const col of columns) {
      const nullable = col.is_nullable === 'YES';
      const optional = nullable || col.column_default !== null;
      out += `          ${col.column_name}${optional ? '?' : ''}: ${tsType(col.udt_name, col.data_type === 'ARRAY')}${nullable ? ' | null' : ''};\n`;
    }
    out += '        };\n        Update: {\n';
    for (const col of columns) {
      const nullable = col.is_nullable === 'YES';
      out += `          ${col.column_name}?: ${tsType(col.udt_name, col.data_type === 'ARRAY')}${nullable ? ' | null' : ''};\n`;
    }
    // supabase-js v2 requires Relationships on every table for its generics
    // to resolve; without it every insert/update argument collapses to never.
    out += '        };\n        Relationships: [];\n      };\n';
  }

  out += '    };\n    Views: { [_ in never]: never };\n    Functions: {\n';
  if (funcs.rowCount) {
    out += `      create_organization: {
        Args: { p_name: string; p_slug?: string | null; p_industry?: string | null };
        Returns: Database['public']['Tables']['organizations']['Row'];
      };\n`;
  }
  out += '    };\n    Enums: {\n';
  for (const e of enums.rows) {
    out += `      ${e.typname}: ${pascal(e.typname)};\n`;
  }
  out += '    };\n    CompositeTypes: { [_ in never]: never };\n  };\n}\n\n';

  out += `// Convenience aliases
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type InsertDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type UpdateDto<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
`;

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`wrote ${OUT}`);
  console.log(`  ${Object.keys(byTable).length} tables, ${enums.rowCount} enums`);
});
