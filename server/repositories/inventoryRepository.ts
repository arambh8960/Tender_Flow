import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import type { SKU, TruckType } from '../../types';

/**
 * Organisation-scoped inventory access.
 *
 * The single place a database row becomes an SKU. Discovery, the technical
 * agent and the admin screens all read through here, so "what does this
 * organisation actually have in stock" has exactly one answer and one
 * mapping — the agents never receive a catalogue posted by the browser.
 */

export interface InventoryRow {
  sku_id: string;
  product_name: string;
  product_category: string | null;
  product_sub_category: string | null;
  oem_brand: string | null;
  specification: Record<string, string> | null;
  available_quantity: number | null;
  truck_type: string | null;
  lead_time_days: number | null;
  cost_price: number | null;
  unit_sales_price: number | null;
  bulk_sales_price: number | null;
  gst_rate: number | null;
  brokerage: number | null;
  min_margin_percent: number | null;
  is_active: boolean | null;
  is_custom_made_possible: boolean | null;
  is_compliance_ready: boolean | null;
  warehouses?: {
    code: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

const SELECT_WITH_WAREHOUSE =
  '*, warehouses:warehouse_id (code, city, state, latitude, longitude)';

export function rowToSku(row: InventoryRow): SKU {
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

export interface InventoryQuery {
  search?: string;
  category?: string;
  includeInactive?: boolean;
  /** Hard ceiling regardless of what the caller asks for. */
  limit?: number;
  offset?: number;
}

const MAX_PAGE = 500;

export class InventoryRepository {
  constructor(
    private client: SupabaseClient<Database>,
    private organizationId: string
  ) {}

  /** Paginated listing for screens. */
  async list(query: InventoryQuery = {}): Promise<{ items: SKU[]; total: number }> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), MAX_PAGE);
    const offset = Math.max(query.offset ?? 0, 0);

    let builder = this.client
      .from('inventory_items')
      .select(SELECT_WITH_WAREHOUSE, { count: 'exact' })
      .eq('organization_id', this.organizationId);

    if (!query.includeInactive) builder = builder.eq('is_active', true);
    if (query.category) builder = builder.eq('product_category', query.category);
    if (query.search) {
      const term = `%${query.search.replace(/[%_]/g, '')}%`;
      builder = builder.or(
        `product_name.ilike.${term},sku_id.ilike.${term},product_category.ilike.${term},oem_brand.ilike.${term}`
      );
    }

    const { data, error, count } = await builder
      .order('product_name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Could not load inventory: ${error.message}`);
    return {
      items: (data as unknown as InventoryRow[]).map(rowToSku),
      total: count ?? 0,
    };
  }

  /**
   * The full active catalogue, for agents that must reason over everything.
   * Bounded — an organisation with 50k SKUs would otherwise blow the AI
   * context and the response size.
   */
  async listActiveForAgents(limit = MAX_PAGE): Promise<SKU[]> {
    const { data, error } = await this.client
      .from('inventory_items')
      .select(SELECT_WITH_WAREHOUSE)
      .eq('organization_id', this.organizationId)
      .eq('is_active', true)
      .order('available_quantity', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Could not load inventory: ${error.message}`);
    return (data as unknown as InventoryRow[]).map(rowToSku);
  }

  async findBySkuId(skuId: string): Promise<SKU | null> {
    const { data, error } = await this.client
      .from('inventory_items')
      .select(SELECT_WITH_WAREHOUSE)
      .eq('organization_id', this.organizationId)
      .eq('sku_id', skuId)
      .maybeSingle();

    if (error) throw new Error(`Could not load SKU: ${error.message}`);
    return data ? rowToSku(data as unknown as InventoryRow) : null;
  }

  async create(input: Record<string, unknown>): Promise<{ id: string; sku_id: string }> {
    const { data, error } = await this.client
      .from('inventory_items')
      .insert({ ...input, organization_id: this.organizationId } as never)
      .select('id, sku_id')
      .single();

    if (error) throw new Error(error.message);
    return data as { id: string; sku_id: string };
  }

  /**
   * Updates by SKU code rather than row id: the SKU code is the identifier
   * the catalogue is keyed on everywhere else in the product, and it is
   * unique per organisation.
   */
  async update(skuId: string, patch: Record<string, unknown>): Promise<boolean> {
    // organization_id is never taken from the patch — a caller must not be
    // able to move a row into another tenant.
    const { organization_id: _ignored, ...safe } = patch as Record<string, unknown>;

    const { data, error } = await this.client
      .from('inventory_items')
      .update(safe as never)
      .eq('sku_id', skuId)
      .eq('organization_id', this.organizationId)
      .select('id');

    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }

  /** Soft delete: history and audit references stay intact. */
  async archive(skuId: string): Promise<boolean> {
    return this.update(skuId, { is_active: false });
  }

  /**
   * Stock adjustment with the invariant enforced server-side.
   * Returns the new quantity, or throws if the result would go negative.
   */
  async adjustStock(skuId: string, delta: number): Promise<number> {
    const { data: current, error: readError } = await this.client
      .from('inventory_items')
      .select('id, available_quantity')
      .eq('organization_id', this.organizationId)
      .eq('sku_id', skuId)
      .maybeSingle();

    if (readError) throw new Error(readError.message);
    if (!current) throw new Error('SKU not found');

    const next = (current.available_quantity ?? 0) + delta;
    if (next < 0) {
      throw new Error(
        `Adjustment would take ${skuId} to ${next}. Stock cannot go negative.`
      );
    }

    const { error } = await this.client
      .from('inventory_items')
      .update({ available_quantity: next })
      .eq('id', current.id)
      .eq('organization_id', this.organizationId);

    if (error) throw new Error(error.message);
    return next;
  }

  /** Absolute set, used by the stock editor. */
  async setStock(skuId: string, quantity: number): Promise<number> {
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
      throw new Error('Quantity must be a non-negative whole number.');
    }

    const { data, error } = await this.client
      .from('inventory_items')
      .update({ available_quantity: quantity })
      .eq('organization_id', this.organizationId)
      .eq('sku_id', skuId)
      .select('available_quantity');

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('SKU not found');
    return data[0].available_quantity ?? 0;
  }

  async countActive(): Promise<number> {
    const { count, error } = await this.client
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', this.organizationId)
      .eq('is_active', true);

    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
