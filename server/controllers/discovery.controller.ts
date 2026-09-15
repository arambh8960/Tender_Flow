import { Request, Response } from 'express';
import { DiscoveryCoordinator } from '../discovery/DiscoveryCoordinator';
import { DiscoveryRepository } from '../discovery/persistence/DiscoveryRepository';
import type { DiscoveryCriteria } from '../discovery/normalization/types';
import type { QualifierSettings } from '../discovery/qualification/TenderQualifier';
import { listPortals } from '../discovery/portals/PortalRegistry';
import { fail } from '../middleware/errorHandler';
import type { SKU, TruckType } from '../../types';

/**
 * Discovery always runs in the context of one organisation.
 *
 * Inventory is loaded server-side FROM THE DATABASE for that organisation.
 * It is deliberately not taken from the request body any more: a client that
 * can post its own catalogue can also post someone else's, and the old
 * endpoint fell back to the bundled demo inventory when none was sent.
 */

function rowToSku(row: any): SKU {
  const wh = row.warehouses ?? null;
  return {
    skuId: row.sku_id,
    productName: row.product_name,
    productCategory: row.product_category ?? '',
    productSubCategory: row.product_sub_category ?? '',
    oemBrand: row.oem_brand ?? '',
    specification: row.specification ?? {},
    availableQuantity: row.available_quantity ?? 0,
    warehouseLocation: wh ? [wh.city, wh.state].filter(Boolean).join(', ') : '',
    warehouseCode: wh?.code ?? '',
    warehouseLat: wh?.latitude ?? 0,
    warehouseLon: wh?.longitude ?? 0,
    truckType: (row.truck_type as TruckType) ?? 'LCV',
    leadTime: row.lead_time_days ?? 0,
    costPrice: Number(row.cost_price ?? 0),
    unitSalesPrice: Number(row.unit_sales_price ?? 0),
    bulkSalesPrice: Number(row.bulk_sales_price ?? 0),
    gstRate: Number(row.gst_rate ?? 18),
    brokerage: row.brokerage ?? undefined,
    minMarginPercent: Number(row.min_margin_percent ?? 0),
    isActive: row.is_active ?? true,
    isCustomMadePossible: row.is_custom_made_possible ?? false,
    isComplianceReady: row.is_compliance_ready ?? false,
  };
}

export async function runDiscovery(req: Request, res: Response) {
  const auth = req.auth!;
  const org = req.org!;

  const { portal = 'gem', category, categories, filters = {}, mode } = req.body ?? {};
  const isAdvanced = mode === 'advanced' || filters?.searchMode === 'ADVANCED';

  const repository = new DiscoveryRepository(auth.db, org.id);

  // ── organisation's own inventory ────────────────────────────────────────
  const inventoryRows = await repository.loadInventory();
  const inventory = inventoryRows.map(rowToSku);

  if (inventory.length === 0) {
    return fail(
      res,
      400,
      'NO_INVENTORY',
      'This organisation has no active inventory, so tenders cannot be qualified. Add inventory first.'
    );
  }

  // ── organisation's own discovery settings, overridable per request ──────
  const stored = await repository.loadDiscoverySettings();
  const certificates = await repository.loadValidCertificateNames();

  const settings: QualifierSettings = {
    assumedAvgKms: Number(filters.manualAvgKms ?? stored?.manual_avg_kms ?? 400),
    ratePerKm: Number(filters.manualRatePerKm ?? stored?.manual_rate_per_km ?? 55),
    allowEmd: filters.allowEMD ?? stored?.allow_emd ?? true,
    minMatchThreshold: Number(filters.minMatchThreshold ?? stored?.min_match_threshold ?? 20),
    // The organisation's own haul limit. Null leaves the default gate in
    // place rather than disabling feasibility checking altogether.
    maxDistanceKm: stored?.max_distance_km ?? null,
    bypassFilters: filters.bypassFilters === true,
    validCertificates: certificates,
  };

  const resolvedCategories: string[] = isAdvanced
    ? []
    : (Array.isArray(categories) && categories.length ? categories
      : Array.isArray(filters.categories) && filters.categories.length ? filters.categories
      : category ? [category]
      : stored?.categories ?? []);

  if (!isAdvanced && resolvedCategories.length === 0) {
    return fail(res, 400, 'NO_CRITERIA', 'Provide a category to search for.');
  }

  const criteria: DiscoveryCriteria = {
    categories: resolvedCategories,
    advanced: isAdvanced ? filters : undefined,
    closingWithinDays: 90,
  };

  const coordinator = new DiscoveryCoordinator((agent, message, data) => {
    console.log(`[${agent}] [org:${org.id}] ${message}`, data ?? '');
  });

  const outcome = await coordinator.run({
    organizationId: org.id,
    portal,
    criteria,
    inventory,
    settings,
    triggeredBy: auth.userId,
    repository,
  });

  if (outcome.status === 'failed') {
    return fail(res, 502, 'DISCOVERY_FAILED', 'Tender discovery could not be completed', {
      summary: {
        runId: outcome.runId,
        status: outcome.status,
        portal,
        counts: outcome.counts,
        errors: outcome.errors,
      },
    });
  }

  // Shaped for the existing Tender-based UI so the discovery screen keeps working.
  const data = outcome.results.map(r => ({
    id: r.tender.externalId,
    title: r.tender.title,
    org: r.tender.buyer ?? 'Unknown buyer',
    endDate: r.tender.closingAt ? new Date(r.tender.closingAt).toLocaleDateString('en-GB').replace(/\//g, '-') : '',
    category: r.tender.category ?? '',
    url: r.tender.tenderUrl ?? '',
    emdRequired: Boolean(r.tender.emdRequired),
    consigneeLocation: r.tender.location ?? 'Location not disclosed',
    distance: r.breakdown.logistics.distanceKm,
    distanceSource: r.breakdown.logistics.distanceSource,
    estimatedLogisticsCost: r.breakdown.logistics.estimatedCost,
    matchScore: r.scores.inventory_score,
    overallScore: r.scores.overall_score,
    inStock: r.breakdown.inventory.inStock,
    isQualified: r.isQualified,
    risk: r.scores.overall_score >= 75 ? 'Low' : r.scores.overall_score >= 45 ? 'Medium' : 'High',
    reason: r.reason,
    scores: r.scores,
  }));

  return res.json({
    success: true,
    data,
    summary: {
      runId: outcome.runId,
      status: outcome.status,
      portal,
      startedAt: outcome.startedAt,
      completedAt: outcome.completedAt,
      counts: outcome.counts,
      errors: outcome.errors,
    },
  });
}

export async function listSupportedPortals(_req: Request, res: Response) {
  return res.json({ success: true, data: listPortals() });
}

/** Discovery history for the active organisation. */
export async function listDiscoveryRuns(req: Request, res: Response) {
  const auth = req.auth!;
  const org = req.org!;

  const { data, error } = await auth.db
    .from('discovery_runs')
    .select('*')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return fail(res, 500, 'RUNS_FETCH_FAILED', 'Could not load discovery history.');
  return res.json({ success: true, data });
}
