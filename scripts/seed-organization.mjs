/**
 * Migrates the bundled static data into a real organisation.
 *
 *   node scripts/seed-organization.mjs --email you@example.com [--name "Acme"]
 *   node scripts/seed-organization.mjs --org <uuid>
 *
 * Sources:
 *   data/configData.ts   -> organizations, organization_profiles,
 *                           signing_authorities, organization_discovery_settings
 *   data/storeData.ts    -> warehouses (derived) + inventory_items
 *   legacy Postgres      -> company_profile, compliance_vault
 *
 * Idempotent: every write is an upsert keyed on the organisation. The static
 * files are NOT deleted — they remain the seed source and the demo fixture.
 */
import { withSupabase, withLegacy } from './db.mjs';
import { pathToFileURL } from 'url';
import path from 'path';

// data/*.ts are TypeScript, so this script is run under tsx (see npm run db:seed).

const args = process.argv.slice(2);
const argOf = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const email = argOf('email');
const explicitOrg = argOf('org');
const orgNameArg = argOf('name');

if (!email && !explicitOrg) {
  console.error('Usage: node scripts/seed-organization.mjs --email <owner-email> [--name "Org"]');
  console.error('   or: node scripts/seed-organization.mjs --org <organization-uuid>');
  process.exit(1);
}

const { productInventory } = await import(pathToFileURL(path.resolve('data/storeData.ts')).href);
const { initialConfig } = await import(pathToFileURL(path.resolve('data/configData.ts')).href);

await withSupabase(async c => {
  // ── resolve the target organisation ───────────────────────────────────
  let orgId = explicitOrg;
  let ownerId = null;

  if (!orgId) {
    const user = await c.query('select id from auth.users where lower(email) = lower($1)', [email]);
    if (user.rowCount === 0) {
      console.error(`No Supabase auth user with email ${email}. Sign up in the app first, then re-run.`);
      process.exit(1);
    }
    ownerId = user.rows[0].id;

    const existing = await c.query(
      `select o.id, o.name from public.organizations o
       join public.organization_members m on m.organization_id = o.id
       where m.user_id = $1 and m.status = 'active'
       order by m.created_at limit 1`,
      [ownerId]
    );

    if (existing.rowCount > 0) {
      orgId = existing.rows[0].id;
      console.log(`Using existing organisation "${existing.rows[0].name}" (${orgId})`);
    } else {
      const name = orgNameArg || initialConfig.companyDetails.companyName;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const created = await c.query(
        `insert into public.organizations (name, slug, industry, created_by)
         values ($1, $2, $3, $4) returning id`,
        [name, slug, initialConfig.companyDetails.domain, ownerId]
      );
      orgId = created.rows[0].id;
      await c.query(
        `insert into public.organization_members (organization_id, user_id, role, status)
         values ($1, $2, 'owner', 'active')
         on conflict (organization_id, user_id) do nothing`,
        [orgId, ownerId]
      );
      console.log(`Created organisation "${name}" (${orgId}) with ${email} as owner`);
    }
  }

  const cd = initialConfig.companyDetails;

  // ── company profile: prefer the legacy DB row, fall back to configData ──
  let legacyProfile = null;
  let legacyCerts = [];
  try {
    await withLegacy(async lc => {
      const p = await lc.query('select * from company_profile limit 1');
      legacyProfile = p.rows[0] ?? null;
      const certs = await lc.query(
        `select cert_name, category, issued_date, expiry_date, is_valid, file_path
         from compliance_vault order by id`
      );
      legacyCerts = certs.rows;
    });
    console.log(`Legacy DB: ${legacyProfile ? '1 profile' : 'no profile'}, ${legacyCerts.length} certificates`);
  } catch (err) {
    console.log('Legacy DB unavailable; seeding from static files only.');
  }

  await c.query(
    `insert into public.organization_profiles
       (organization_id, legal_name, address, gstin, pan, domain,
        annual_turnover_cr, turnover_year, experience_years, oem_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (organization_id) do update set
       legal_name = excluded.legal_name, address = excluded.address,
       gstin = excluded.gstin, pan = excluded.pan, domain = excluded.domain,
       annual_turnover_cr = excluded.annual_turnover_cr,
       turnover_year = excluded.turnover_year,
       experience_years = excluded.experience_years,
       oem_status = excluded.oem_status`,
    [
      orgId,
      legacyProfile?.company_name ?? cd.companyName,
      legacyProfile?.address ?? cd.companyAddress,
      legacyProfile?.gstin ?? cd.gstin,
      legacyProfile?.pan ?? cd.pan,
      cd.domain,
      legacyProfile?.annual_turnover_cr ?? (Number(String(cd.turnover).replace(/[^\d.]/g, '')) || null),
      cd.turnoverYear,
      legacyProfile?.experience_years ?? null,
      cd.oemStatus,
    ]
  );
  console.log('✓ organization_profiles');

  // ── signing authorities ────────────────────────────────────────────────
  for (const a of initialConfig.signingAuthorities) {
    await c.query(
      `insert into public.signing_authorities (organization_id, name, designation, din)
       select $1,$2,$3,$4
       where not exists (
         select 1 from public.signing_authorities
         where organization_id = $1 and din = $4)`,
      [orgId, a.name, a.designation, a.din]
    );
  }
  console.log(`✓ signing_authorities (${initialConfig.signingAuthorities.length})`);

  // ── discovery settings ─────────────────────────────────────────────────
  const df = initialConfig.discoveryFilters;
  await c.query(
    `insert into public.organization_discovery_settings
       (organization_id, categories, manual_avg_kms, manual_rate_per_km,
        allow_emd, min_match_threshold)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (organization_id) do update set
       categories = excluded.categories,
       manual_avg_kms = excluded.manual_avg_kms,
       manual_rate_per_km = excluded.manual_rate_per_km,
       allow_emd = excluded.allow_emd,
       min_match_threshold = excluded.min_match_threshold`,
    [orgId, df.categories, df.manualAvgKms, df.manualRatePerKm, df.allowEMD, df.minMatchThreshold]
  );
  console.log('✓ organization_discovery_settings');

  // ── warehouses, derived from the SKU rows that denormalised them ───────
  const warehouses = new Map();
  for (const sku of productInventory) {
    if (!sku.warehouseCode || warehouses.has(sku.warehouseCode)) continue;
    const [city, state] = String(sku.warehouseLocation || '').split(',').map(s => s.trim());
    warehouses.set(sku.warehouseCode, {
      code: sku.warehouseCode,
      city: city || null,
      state: state || null,
      latitude: sku.warehouseLat || null,
      longitude: sku.warehouseLon || null,
    });
  }

  const warehouseIds = new Map();
  let isFirst = true;
  for (const w of warehouses.values()) {
    const res = await c.query(
      `insert into public.warehouses
         (organization_id, code, name, city, state, latitude, longitude, is_default)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (organization_id, code) do update set
         city = excluded.city, state = excluded.state,
         latitude = excluded.latitude, longitude = excluded.longitude
       returning id`,
      [orgId, w.code, w.city ? `${w.city} Hub` : w.code, w.city, w.state, w.latitude, w.longitude, isFirst]
    );
    warehouseIds.set(w.code, res.rows[0].id);
    isFirst = false;
  }
  console.log(`✓ warehouses (${warehouses.size})`);

  // ── vehicles, derived from the truck types actually used ───────────────
  const CAPACITY = { MINI_TRUCK: 1.5, LCV: 4, MEDIUM_TRUCK: 9, HEAVY_TRUCK: 20 };
  const RATE = { MINI_TRUCK: 20, LCV: 30, MEDIUM_TRUCK: 25, HEAVY_TRUCK: 55 };
  const truckTypes = [...new Set(productInventory.map(s => s.truckType).filter(Boolean))];
  for (const t of truckTypes) {
    await c.query(
      `insert into public.vehicles (organization_id, truck_type, label, capacity_tons, cost_per_km)
       values ($1,$2,$3,$4,$5)
       on conflict (organization_id, truck_type) do nothing`,
      [orgId, t, t.replace(/_/g, ' '), CAPACITY[t] ?? null, RATE[t] ?? null]
    );
  }
  console.log(`✓ vehicles (${truckTypes.length})`);

  // ── inventory ──────────────────────────────────────────────────────────
  let inserted = 0;
  for (const sku of productInventory) {
    await c.query(
      `insert into public.inventory_items
        (organization_id, sku_id, product_name, product_category, product_sub_category,
         oem_brand, specification, available_quantity, warehouse_id, truck_type,
         lead_time_days, cost_price, unit_sales_price, bulk_sales_price, gst_rate,
         brokerage, min_margin_percent, is_active, is_custom_made_possible, is_compliance_ready)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       on conflict (organization_id, sku_id) do update set
         product_name = excluded.product_name,
         product_category = excluded.product_category,
         available_quantity = excluded.available_quantity,
         unit_sales_price = excluded.unit_sales_price`,
      [
        orgId, sku.skuId, sku.productName, sku.productCategory, sku.productSubCategory,
        sku.oemBrand, JSON.stringify(sku.specification ?? {}), sku.availableQuantity,
        warehouseIds.get(sku.warehouseCode) ?? null, sku.truckType, sku.leadTime,
        sku.costPrice, sku.unitSalesPrice, sku.bulkSalesPrice, sku.gstRate,
        sku.brokerage ?? null, sku.minMarginPercent, sku.isActive,
        sku.isCustomMadePossible, sku.isComplianceReady,
      ]
    );
    inserted++;
  }
  console.log(`✓ inventory_items (${inserted})`);

  // ── compliance documents from the legacy vault ─────────────────────────
  for (const cert of legacyCerts) {
    await c.query(
      `insert into public.compliance_documents
        (organization_id, cert_name, category, issued_date, expiry_date, is_valid, legacy_file_path)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (organization_id, cert_name) do update set
         category = excluded.category, expiry_date = excluded.expiry_date,
         is_valid = excluded.is_valid, legacy_file_path = excluded.legacy_file_path`,
      [orgId, cert.cert_name, cert.category, cert.issued_date, cert.expiry_date, cert.is_valid, cert.file_path]
    );
  }
  console.log(`✓ compliance_documents (${legacyCerts.length})`);

  // ── verification ───────────────────────────────────────────────────────
  const counts = await c.query(
    `select
       (select count(*) from public.inventory_items where organization_id = $1) as inventory,
       (select count(*) from public.warehouses where organization_id = $1) as warehouses,
       (select count(*) from public.vehicles where organization_id = $1) as vehicles,
       (select count(*) from public.compliance_documents where organization_id = $1) as documents,
       (select count(*) from public.signing_authorities where organization_id = $1) as authorities,
       (select count(*) from public.organization_modules where organization_id = $1) as modules`,
    [orgId]
  );
  console.log('\nOrganisation', orgId);
  console.table(counts.rows[0]);
});
