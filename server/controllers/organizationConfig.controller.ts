import { Request, Response } from 'express';
import { z } from 'zod';

import { fail, ok } from '../middleware/errorHandler';
import { validated } from '../middleware/validate';
import { recordAudit } from '../services/audit/auditLog';

/**
 * Organisation configuration that feeds the agents: warehouses (logistics and
 * distance) and financial defaults (costing).
 *
 * Every handler reads req.org, which requireOrgMember derived from the
 * caller's membership. Nothing here accepts an organisation id as an
 * authorisation input.
 */

/* ───────────────────────────── warehouses ───────────────────────────── */

export const warehouseSchema = z.object({
  organizationId: z.string().uuid(),
  code: z.string().min(1).max(40),
  name: z.string().max(160).optional(),
  address: z.string().max(400).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  pincode: z.string().max(12).optional(),
  // Coordinates are what make a measured haul possible. They stay optional
  // because a warehouse can still be located by city name, but a value of
  // exactly 0 is rejected rather than treated as the Gulf of Guinea.
  latitude: z.number().min(-90).max(90).refine(v => v !== 0, 'Use a real latitude.').optional(),
  longitude: z.number().min(-180).max(180).refine(v => v !== 0, 'Use a real longitude.').optional(),
  isDefault: z.boolean().optional(),
});

export const warehouseUpdateSchema = warehouseSchema.partial().extend({
  organizationId: z.string().uuid(),
});

export async function listWarehouses(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;

  const { data, error } = await auth.db
    .from('warehouses')
    .select('*')
    .eq('organization_id', org.id)
    .order('code', { ascending: true });

  if (error) return fail(res, 500, 'WAREHOUSES_FETCH_FAILED', 'Warehouses could not be loaded.');

  // Say plainly which ones can actually be measured from, so the UI can
  // explain why a tender fell back to an estimated distance.
  const warehouses = (data ?? []).map(w => ({
    ...w,
    hasCoordinates: Boolean(w.latitude && w.longitude),
  }));

  return ok(res, warehouses);
}

export async function createWarehouse(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof warehouseSchema>>(req);

  const { data, error } = await auth.db
    .from('warehouses')
    .insert({
      organization_id: org.id,
      code: input.code,
      name: input.name ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      pincode: input.pincode ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      is_default: input.isDefault ?? false,
    } as never)
    .select('id, code')
    .single();

  if (error) {
    if (error.code === '23505') {
      return fail(res, 409, 'DUPLICATE_WAREHOUSE', `A warehouse with code ${input.code} already exists.`);
    }
    return fail(res, 403, 'WAREHOUSE_CREATE_FAILED', 'The warehouse could not be created.');
  }

  await recordAudit(
    {
      organizationId: org.id,
      action: 'organization.settings_updated',
      entityType: 'warehouse',
      entityId: data.id,
      metadata: { code: data.code, created: true },
    },
    req
  );

  return ok(res, data);
}

export async function updateWarehouse(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof warehouseUpdateSchema>>(req);
  const warehouseId = String(req.params.warehouseId);

  const map: Record<string, string> = {
    code: 'code',
    name: 'name',
    address: 'address',
    city: 'city',
    state: 'state',
    pincode: 'pincode',
    latitude: 'latitude',
    longitude: 'longitude',
    isDefault: 'is_default',
  };

  const patch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) patch[column] = value;
  }

  if (Object.keys(patch).length === 0) {
    return fail(res, 400, 'NOTHING_TO_UPDATE', 'No updatable fields were supplied.');
  }

  const { data, error } = await auth.db
    .from('warehouses')
    .update(patch as never)
    .eq('id', warehouseId)
    .eq('organization_id', org.id)
    .select('id');

  if (error) return fail(res, 403, 'WAREHOUSE_UPDATE_FAILED', 'The warehouse could not be updated.');
  if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Warehouse not found.');

  return ok(res, { id: warehouseId, updated: Object.keys(patch) });
}

export async function deleteWarehouse(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const warehouseId = String(req.params.warehouseId);

  // Inventory points at warehouses; removing one that still holds stock would
  // strip the coordinates those SKUs are measured from.
  const { count } = await auth.db
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)
    .eq('warehouse_id', warehouseId);

  if ((count ?? 0) > 0) {
    return fail(
      res,
      409,
      'WAREHOUSE_IN_USE',
      `${count} inventory item(s) are stored at this warehouse. Move them before removing it.`
    );
  }

  const { data, error } = await auth.db
    .from('warehouses')
    .delete()
    .eq('id', warehouseId)
    .eq('organization_id', org.id)
    .select('id');

  if (error) return fail(res, 403, 'WAREHOUSE_DELETE_FAILED', 'The warehouse could not be removed.');
  if (!data?.length) return fail(res, 404, 'NOT_FOUND', 'Warehouse not found.');

  return ok(res, { id: warehouseId, deleted: true });
}

/* ────────────────────────── financial settings ──────────────────────── */

export const financialSettingsSchema = z.object({
  organizationId: z.string().uuid(),
  defaultGstRate: z.number().min(0).max(100).optional(),
  brokeragePercent: z.number().min(0).max(100).optional(),
  targetMarginPercent: z.number().min(0).max(100).optional(),
  transportBufferPercent: z.number().min(0).max(100).optional(),
  defaultEmdPercent: z.number().min(0).max(100).optional(),
  defaultEpbgPercent: z.number().min(0).max(100).optional(),
  ratePerKm: z.number().min(0).max(10_000).optional(),
});

export async function getFinancialSettings(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;

  const { data, error } = await auth.db
    .from('organization_financial_settings')
    .select('*')
    .eq('organization_id', org.id)
    .maybeSingle();

  if (error) return fail(res, 500, 'FINANCIAL_FETCH_FAILED', 'Financial defaults could not be loaded.');
  return ok(res, data);
}

export async function updateFinancialSettings(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof financialSettingsSchema>>(req);

  const map: Record<string, string> = {
    defaultGstRate: 'default_gst_rate',
    brokeragePercent: 'brokerage_percent',
    targetMarginPercent: 'target_margin_percent',
    transportBufferPercent: 'transport_buffer_percent',
    defaultEmdPercent: 'default_emd_percent',
    defaultEpbgPercent: 'default_epbg_percent',
    ratePerKm: 'rate_per_km',
  };

  const patch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) patch[column] = value;
  }

  if (Object.keys(patch).length === 0) {
    return fail(res, 400, 'NOTHING_TO_UPDATE', 'No updatable fields were supplied.');
  }

  const { error } = await auth.db
    .from('organization_financial_settings')
    .upsert({ organization_id: org.id, ...patch } as never, { onConflict: 'organization_id' });

  if (error) return fail(res, 403, 'FINANCIAL_UPDATE_FAILED', 'Financial defaults could not be updated.');

  await recordAudit(
    {
      organizationId: org.id,
      action: 'organization.settings_updated',
      entityType: 'organization_financial_settings',
      entityId: org.id,
      metadata: { fields: Object.keys(patch) },
    },
    req
  );

  return ok(res, { updated: Object.keys(patch) });
}

/* ─────────────────────── setup completeness ─────────────────────────── */

/**
 * What still needs configuring.
 *
 * Computed from real rows rather than a checklist the user ticks off, so it
 * cannot drift from reality — and so a "complete" badge always means the
 * agents actually have what they need.
 */
export async function getSetupProgress(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const today = new Date().toISOString().slice(0, 10);

  const countOf = async (table: 'inventory_items' | 'warehouses' | 'compliance_documents', build: (q: any) => any = q => q) => {
    const { count } = await build(
      auth.db.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', org.id)
    );
    return count ?? 0;
  };

  const [profile, settings, inventory, warehouses, documents, authorities] = await Promise.all([
    auth.db.from('organization_profiles').select('gstin, pan, address, legal_name').eq('organization_id', org.id).maybeSingle(),
    auth.db.from('organization_discovery_settings').select('categories, manual_rate_per_km').eq('organization_id', org.id).maybeSingle(),
    countOf('inventory_items', q => q.eq('is_active', true)),
    countOf('warehouses'),
    countOf('compliance_documents', q => q.is('archived_at', null).gte('expiry_date', today)),
    auth.db.from('signing_authorities').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
  ]);

  const steps = [
    {
      key: 'profile',
      label: 'Organisation profile',
      complete: Boolean(profile.data?.gstin && profile.data?.pan && profile.data?.address),
      hint: 'Add GSTIN, PAN and a registered address.',
      href: '/organization/settings',
    },
    {
      key: 'warehouses',
      label: 'Warehouses',
      complete: warehouses > 0,
      hint: 'Add at least one warehouse so delivery distance can be measured.',
      href: '/organization/settings',
    },
    {
      key: 'inventory',
      label: 'Inventory',
      complete: inventory > 0,
      hint: 'Add the products you supply — tenders are matched against them.',
      href: '/admin/inventory',
    },
    {
      key: 'compliance',
      label: 'Compliance vault',
      complete: documents > 0,
      hint: 'Upload your certificates so qualification can check them.',
      href: '/admin/compliance',
    },
    {
      key: 'discovery',
      label: 'Discovery configuration',
      complete: Boolean((settings.data?.categories?.length ?? 0) > 0 && Number(settings.data?.manual_rate_per_km ?? 0) > 0),
      hint: 'Choose target categories and a freight rate.',
      href: '/admin/discovery',
    },
    {
      key: 'authorities',
      label: 'Signing authorities',
      complete: (authorities.count ?? 0) > 0,
      hint: 'Record who may sign a bid submission.',
      href: '/organization/settings',
    },
  ];

  const completed = steps.filter(s => s.complete).length;

  return ok(res, {
    steps,
    completed,
    total: steps.length,
    percentComplete: Math.round((completed / steps.length) * 100),
    counts: { inventory, warehouses, validDocuments: documents },
  });
}
