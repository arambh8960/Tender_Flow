import { Request, Response } from 'express';
import { z } from 'zod';
import { fail, ok } from '../middleware/errorHandler';
import { validated } from '../middleware/validate';
import { InventoryRepository } from '../repositories/inventoryRepository';
import { recordAudit } from '../services/audit/auditLog';

/**
 * Company profile, settings, signing authorities and inventory.
 *
 * Authorisation is entirely middleware-driven: requireAuth establishes who
 * the caller is, requireOrgMember(role) establishes which tenant and with
 * what rights. The previous shared-password gate is gone — it authenticated
 * nobody, was identical for every customer, and shipped in the repository.
 */

/* ───────────────────────────── schemas ──────────────────────────────── */

export const companyProfileSchema = z.object({
  organizationId: z.string().uuid(),
  legalName: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(15).optional(),
  domain: z.string().max(100).optional(),
  annualTurnoverCr: z.number().nonnegative().optional(),
  turnoverYear: z.string().max(20).optional(),
  experienceYears: z.number().int().nonnegative().max(200).optional(),
  oemStatus: z.string().max(50).optional(),
});

export const discoverySettingsSchema = z.object({
  organizationId: z.string().uuid(),
  defaultPortals: z.array(z.string().max(40)).max(10).optional(),
  categories: z.array(z.string().max(120)).max(50).optional(),
  manualAvgKms: z.number().int().min(0).max(10000).optional(),
  manualRatePerKm: z.number().min(0).max(10000).optional(),
  allowEmd: z.boolean().optional(),
  minMatchThreshold: z.number().int().min(0).max(100).optional(),
  deliveryType: z.string().max(60).optional(),
});

export const inventoryCreateSchema = z.object({
  organizationId: z.string().uuid(),
  skuId: z.string().min(1).max(60),
  productName: z.string().min(1).max(200),
  productCategory: z.string().max(120).optional(),
  productSubCategory: z.string().max(120).optional(),
  oemBrand: z.string().max(120).optional(),
  specification: z.record(z.string(), z.string()).optional(),
  availableQuantity: z.number().int().min(0).default(0),
  warehouseId: z.string().uuid().nullable().optional(),
  truckType: z.enum(['MINI_TRUCK', 'LCV', 'MEDIUM_TRUCK', 'HEAVY_TRUCK']).optional(),
  leadTimeDays: z.number().int().min(0).max(3650).optional(),
  costPrice: z.number().min(0).optional(),
  unitSalesPrice: z.number().min(0).optional(),
  bulkSalesPrice: z.number().min(0).optional(),
  gstRate: z.number().min(0).max(100).optional(),
  brokerage: z.number().min(0).optional(),
  minMarginPercent: z.number().min(0).max(100).optional(),
  isCustomMadePossible: z.boolean().optional(),
  isComplianceReady: z.boolean().optional(),
});

export const inventoryUpdateSchema = inventoryCreateSchema.partial().extend({
  organizationId: z.string().uuid(),
});

export const stockSchema = z
  .object({
    organizationId: z.string().uuid(),
    skuId: z.string().min(1).max(60),
    quantity: z.number().int().min(0).optional(),
    delta: z.number().int().optional(),
  })
  .refine(v => v.quantity !== undefined || v.delta !== undefined, {
    message: 'Provide either an absolute quantity or a delta.',
  });

export const signingAuthoritySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(200),
  designation: z.string().max(120).optional(),
  din: z.string().max(40).optional(),
});

/* ───────────────────────── company profile ──────────────────────────── */

export async function getCompanyProfile(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;

  const [profile, organization, settings, authorities] = await Promise.all([
    auth.db.from('organization_profiles').select('*').eq('organization_id', org.id).maybeSingle(),
    auth.db.from('organizations').select('*').eq('id', org.id).maybeSingle(),
    auth.db.from('organization_discovery_settings').select('*').eq('organization_id', org.id).maybeSingle(),
    auth.db.from('signing_authorities').select('*').eq('organization_id', org.id).order('name'),
  ]);

  return ok(res, {
    organization: organization.data ?? null,
    profile: profile.data ?? null,
    settings: settings.data ?? null,
    signingAuthorities: authorities.data ?? [],
    role: org.role,
  });
}

export async function updateCompanyProfile(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof companyProfileSchema>>(req);

  const patch = {
    legal_name: input.legalName,
    address: input.address,
    gstin: input.gstin,
    pan: input.pan,
    domain: input.domain,
    annual_turnover_cr: input.annualTurnoverCr,
    turnover_year: input.turnoverYear,
    experience_years: input.experienceYears,
    oem_status: input.oemStatus,
  };

  // Drop undefined so a partial update does not blank out unsent fields.
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

  const { error } = await auth.db
    .from('organization_profiles')
    .upsert({ organization_id: org.id, ...defined } as never, { onConflict: 'organization_id' });

  if (error) return fail(res, 403, 'PROFILE_UPDATE_FAILED', 'The company profile could not be updated.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'organization.profile_updated',
      entityType: 'organization_profile',
      entityId: org.id,
      metadata: { fields: Object.keys(defined) },
    },
    req
  );

  return ok(res, { updated: Object.keys(defined) });
}

/* ──────────────────────── discovery settings ────────────────────────── */

export async function updateDiscoverySettings(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof discoverySettingsSchema>>(req);

  const patch = {
    default_portals: input.defaultPortals,
    categories: input.categories,
    manual_avg_kms: input.manualAvgKms,
    manual_rate_per_km: input.manualRatePerKm,
    allow_emd: input.allowEmd,
    min_match_threshold: input.minMatchThreshold,
    delivery_type: input.deliveryType,
  };
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

  const { error } = await auth.db
    .from('organization_discovery_settings')
    .upsert({ organization_id: org.id, ...defined } as never, { onConflict: 'organization_id' });

  if (error) return fail(res, 403, 'SETTINGS_UPDATE_FAILED', 'Discovery settings could not be updated.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'organization.settings_updated',
      entityType: 'organization_discovery_settings',
      entityId: org.id,
      metadata: { fields: Object.keys(defined) },
    },
    req
  );

  return ok(res, { updated: Object.keys(defined) });
}

/* ────────────────────── signing authorities ─────────────────────────── */

export async function createSigningAuthority(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof signingAuthoritySchema>>(req);

  const { data, error } = await auth.db
    .from('signing_authorities')
    .insert({
      organization_id: org.id,
      name: input.name,
      designation: input.designation ?? null,
      din: input.din ?? null,
    } as never)
    .select('id')
    .single();

  if (error) return fail(res, 403, 'AUTHORITY_CREATE_FAILED', 'The signing authority could not be added.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'signing_authority.created',
      entityType: 'signing_authority',
      entityId: data.id,
      metadata: { name: input.name },
    },
    req
  );

  return ok(res, { id: data.id });
}

export async function deleteSigningAuthority(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const id = String(req.params.authorityId);

  const { data, error } = await auth.db
    .from('signing_authorities')
    .delete()
    .eq('id', id)
    .eq('organization_id', org.id)
    .select('id');

  if (error) return fail(res, 403, 'AUTHORITY_DELETE_FAILED', 'The signing authority could not be removed.');
  if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Signing authority not found.');

  await recordAudit(
    { organizationId: org.id, action: 'signing_authority.deleted', entityType: 'signing_authority', entityId: id },
    req
  );

  return ok(res, { id, deleted: true });
}

/* ───────────────────────────── inventory ────────────────────────────── */

export async function listInventory(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const repo = new InventoryRepository(auth.db, org.id);

  const { items, total } = await repo.list({
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    includeInactive: req.query.includeInactive === 'true',
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  });

  return ok(res, items, { total });
}

export async function createInventoryItem(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof inventoryCreateSchema>>(req);
  const repo = new InventoryRepository(auth.db, org.id);

  try {
    const created = await repo.create({
      sku_id: input.skuId,
      product_name: input.productName,
      product_category: input.productCategory ?? null,
      product_sub_category: input.productSubCategory ?? null,
      oem_brand: input.oemBrand ?? null,
      specification: input.specification ?? {},
      available_quantity: input.availableQuantity ?? 0,
      warehouse_id: input.warehouseId ?? null,
      truck_type: input.truckType ?? null,
      lead_time_days: input.leadTimeDays ?? null,
      cost_price: input.costPrice ?? null,
      unit_sales_price: input.unitSalesPrice ?? null,
      bulk_sales_price: input.bulkSalesPrice ?? null,
      gst_rate: input.gstRate ?? 18,
      brokerage: input.brokerage ?? null,
      min_margin_percent: input.minMarginPercent ?? null,
      is_custom_made_possible: input.isCustomMadePossible ?? false,
      is_compliance_ready: input.isComplianceReady ?? false,
    });

    await recordAudit(
      {
        organizationId: org.id,
        action: 'inventory.created',
        entityType: 'inventory_item',
        entityId: created.id,
        metadata: { skuId: created.sku_id, productName: input.productName },
      },
      req
    );

    return ok(res, created);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('duplicate key')) {
      return fail(res, 409, 'DUPLICATE_SKU', `SKU ${input.skuId} already exists in this organisation.`);
    }
    return fail(res, 400, 'INVENTORY_CREATE_FAILED', 'The item could not be created.');
  }
}

export async function updateInventoryItem(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof inventoryUpdateSchema>>(req);
  const repo = new InventoryRepository(auth.db, org.id);
  const skuId = String(req.params.skuId);

  const patch: Record<string, unknown> = {};
  const map: Record<string, string> = {
    productName: 'product_name',
    productCategory: 'product_category',
    productSubCategory: 'product_sub_category',
    oemBrand: 'oem_brand',
    specification: 'specification',
    availableQuantity: 'available_quantity',
    warehouseId: 'warehouse_id',
    truckType: 'truck_type',
    leadTimeDays: 'lead_time_days',
    costPrice: 'cost_price',
    unitSalesPrice: 'unit_sales_price',
    bulkSalesPrice: 'bulk_sales_price',
    gstRate: 'gst_rate',
    brokerage: 'brokerage',
    minMarginPercent: 'min_margin_percent',
    isCustomMadePossible: 'is_custom_made_possible',
    isComplianceReady: 'is_compliance_ready',
  };

  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) patch[column] = value;
  }

  if (Object.keys(patch).length === 0) {
    return fail(res, 400, 'NOTHING_TO_UPDATE', 'No updatable fields were supplied.');
  }

  try {
    const updated = await repo.update(skuId, patch);
    if (!updated) return fail(res, 404, 'NOT_FOUND', 'Item not found.');

    await recordAudit(
      {
        organizationId: org.id,
        action: 'inventory.updated',
        entityType: 'inventory_item',
        entityId: skuId,
        metadata: { fields: Object.keys(patch) },
      },
      req
    );

    return ok(res, { skuId, updated: Object.keys(patch) });
  } catch {
    return fail(res, 400, 'INVENTORY_UPDATE_FAILED', 'The item could not be updated.');
  }
}

export async function archiveInventoryItem(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const repo = new InventoryRepository(auth.db, org.id);
  const skuId = String(req.params.skuId);

  const archived = await repo.archive(skuId);
  if (!archived) return fail(res, 404, 'NOT_FOUND', 'Item not found.');

  await recordAudit(
    { organizationId: org.id, action: 'inventory.archived', entityType: 'inventory_item', entityId: skuId },
    req
  );

  return ok(res, { skuId, archived: true });
}

/** Absolute set or relative adjustment; negative resulting stock is rejected. */
export async function updateStock(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof stockSchema>>(req);
  const repo = new InventoryRepository(auth.db, org.id);

  try {
    const quantity =
      input.quantity !== undefined
        ? await repo.setStock(input.skuId, input.quantity)
        : await repo.adjustStock(input.skuId, input.delta as number);

    await recordAudit(
      {
        organizationId: org.id,
        action: 'inventory.stock_adjusted',
        entityType: 'inventory_item',
        entityId: input.skuId,
        metadata: { quantity, delta: input.delta ?? null, absolute: input.quantity ?? null },
      },
      req
    );

    return ok(res, { skuId: input.skuId, availableQuantity: quantity });
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'SKU not found') return fail(res, 404, 'NOT_FOUND', 'SKU not found.');
    return fail(res, 400, 'STOCK_UPDATE_REJECTED', message);
  }
}

/* ───────────────────── compliance snapshot (agents) ─────────────────── */

/**
 * What the organisation can currently certify. Used by the qualification
 * engine, which must never treat an expired certificate as held.
 */
export async function getComplianceSnapshot(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;

  const [profileResult, certificatesResult] = await Promise.all([
    auth.db.from('organization_profiles').select('*').eq('organization_id', org.id).maybeSingle(),
    auth.db
      .from('compliance_documents')
      .select('id, cert_name, category, expiry_date, is_valid')
      .eq('organization_id', org.id)
      .is('archived_at', null),
  ]);

  const today = new Date();
  const certificates = (certificatesResult.data ?? []).map(c => ({
    ...c,
    isCurrentlyValid: Boolean(c.expiry_date && new Date(c.expiry_date) >= today),
  }));

  return ok(res, { profile: profileResult.data ?? null, certificates });
}
