import { supabase } from '../client';
import { unwrap, unwrapList } from './base';
import type { Tables, InsertDto, UpdateDto } from '../../../../database.types';
import type { SKU, TruckType } from '../../../../types';

export type InventoryRow = Tables<'inventory_items'>;
export type WarehouseRow = Tables<'warehouses'>;

/**
 * The app's domain model is SKU (camelCase, warehouse fields inlined). The
 * database is normalised snake_case with warehouses in their own table.
 * These mappers are the single place that translation happens — previously
 * no mapper existed at all, which is why the frontend never used the
 * inventory endpoint and read from storeData.ts instead.
 */
export function rowToSku(row: InventoryRow, warehouse?: WarehouseRow | null): SKU {
  return {
    skuId: row.sku_id,
    productName: row.product_name,
    productCategory: row.product_category ?? '',
    productSubCategory: row.product_sub_category ?? '',
    oemBrand: row.oem_brand ?? '',
    specification: (row.specification as Record<string, string>) ?? {},
    availableQuantity: row.available_quantity ?? 0,
    warehouseLocation: warehouse
      ? [warehouse.city, warehouse.state].filter(Boolean).join(', ')
      : '',
    warehouseCode: warehouse?.code ?? '',
    warehouseLat: warehouse?.latitude ?? 0,
    warehouseLon: warehouse?.longitude ?? 0,
    truckType: (row.truck_type as TruckType) ?? 'LCV',
    leadTime: row.lead_time_days ?? 0,
    costPrice: Number(row.cost_price ?? 0),
    unitSalesPrice: Number(row.unit_sales_price ?? 0),
    bulkSalesPrice: Number(row.bulk_sales_price ?? 0),
    gstRate: Number(row.gst_rate ?? 18),
    brokerage: row.brokerage === null ? undefined : Number(row.brokerage),
    minMarginPercent: Number(row.min_margin_percent ?? 0),
    isActive: row.is_active ?? true,
    isCustomMadePossible: row.is_custom_made_possible ?? false,
    isComplianceReady: row.is_compliance_ready ?? false,
  };
}

export function skuToInsert(sku: SKU, organizationId: string, warehouseId?: string | null): InsertDto<'inventory_items'> {
  return {
    organization_id: organizationId,
    sku_id: sku.skuId,
    product_name: sku.productName,
    product_category: sku.productCategory,
    product_sub_category: sku.productSubCategory,
    oem_brand: sku.oemBrand,
    specification: sku.specification as never,
    available_quantity: sku.availableQuantity,
    warehouse_id: warehouseId ?? null,
    truck_type: sku.truckType,
    lead_time_days: sku.leadTime,
    cost_price: sku.costPrice,
    unit_sales_price: sku.unitSalesPrice,
    bulk_sales_price: sku.bulkSalesPrice,
    gst_rate: sku.gstRate,
    brokerage: sku.brokerage ?? null,
    min_margin_percent: sku.minMarginPercent,
    is_active: sku.isActive,
    is_custom_made_possible: sku.isCustomMadePossible,
    is_compliance_ready: sku.isComplianceReady,
  };
}

export const InventoryRepository = {
  /** Organisation-scoped. RLS enforces the same boundary independently. */
  async listSkus(organizationId: string): Promise<SKU[]> {
    const res = await supabase
      .from('inventory_items')
      .select('*, warehouses(*)')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('product_name');

    const rows = unwrapList(res as { data: any[] | null; error: any });
    return rows.map(r => {
      const { warehouses, ...item } = r;
      return rowToSku(item as InventoryRow, warehouses as WarehouseRow | null);
    });
  },

  async listRaw(organizationId: string): Promise<InventoryRow[]> {
    return unwrapList(
      await supabase.from('inventory_items').select('*').eq('organization_id', organizationId).order('product_name')
    );
  },

  async upsertSku(organizationId: string, sku: SKU, warehouseId?: string | null): Promise<InventoryRow> {
    return unwrap(
      await supabase
        .from('inventory_items')
        .upsert(skuToInsert(sku, organizationId, warehouseId), { onConflict: 'organization_id,sku_id' })
        .select()
        .single()
    );
  },

  async updateStock(organizationId: string, skuId: string, quantity: number): Promise<void> {
    const res = await supabase
      .from('inventory_items')
      .update({ available_quantity: quantity })
      .eq('organization_id', organizationId)
      .eq('sku_id', skuId);
    if (res.error) throw res.error;
  },

  async remove(organizationId: string, skuId: string): Promise<void> {
    const res = await supabase
      .from('inventory_items')
      .delete()
      .eq('organization_id', organizationId)
      .eq('sku_id', skuId);
    if (res.error) throw res.error;
  },
};

export const WarehouseRepository = {
  async list(organizationId: string): Promise<WarehouseRow[]> {
    return unwrapList(
      await supabase.from('warehouses').select('*').eq('organization_id', organizationId).order('code')
    );
  },

  async upsert(organizationId: string, patch: Omit<InsertDto<'warehouses'>, 'organization_id'>): Promise<WarehouseRow> {
    return unwrap(
      await supabase
        .from('warehouses')
        .upsert({ ...patch, organization_id: organizationId }, { onConflict: 'organization_id,code' })
        .select()
        .single()
    );
  },

  async update(id: string, patch: UpdateDto<'warehouses'>): Promise<WarehouseRow> {
    return unwrap(await supabase.from('warehouses').update(patch).eq('id', id).select().single());
  },
};

export const VehicleRepository = {
  async list(organizationId: string): Promise<Tables<'vehicles'>[]> {
    return unwrapList(
      await supabase.from('vehicles').select('*').eq('organization_id', organizationId).order('truck_type')
    );
  },

  async upsert(organizationId: string, patch: Omit<InsertDto<'vehicles'>, 'organization_id'>) {
    return unwrap(
      await supabase
        .from('vehicles')
        .upsert({ ...patch, organization_id: organizationId }, { onConflict: 'organization_id,truck_type' })
        .select()
        .single()
    );
  },
};

export const SupplierRepository = {
  async list(organizationId: string): Promise<Tables<'suppliers'>[]> {
    return unwrapList(
      await supabase.from('suppliers').select('*').eq('organization_id', organizationId).order('name')
    );
  },
};
