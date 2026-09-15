import type { SKU } from '../../types';

/**
 * Test inventory.
 *
 * These are FIXTURES, not seed data. Nothing in the application imports
 * them: a new company starts with an empty catalogue, and the former
 * data/storeData.ts default is exactly what this replaces.
 */

export function makeSku(overrides: Partial<SKU> = {}): SKU {
  return {
    skuId: 'SKU-BASE',
    productName: 'Generic Product',
    productCategory: 'General',
    productSubCategory: 'Standard',
    oemBrand: 'TestBrand',
    specification: {},
    availableQuantity: 100,
    warehouseLocation: 'Jalandhar, Punjab',
    warehouseCode: 'WH-JAL',
    warehouseLat: 31.326,
    warehouseLon: 75.5762,
    truckType: 'LCV',
    leadTime: 7,
    costPrice: 800,
    unitSalesPrice: 1000,
    bulkSalesPrice: 950,
    gstRate: 18,
    minMarginPercent: 10,
    isActive: true,
    isCustomMadePossible: false,
    isComplianceReady: true,
    ...overrides,
  };
}

/** Armoured cable, fully in stock, with IS standards recorded. */
export const CABLE_SKU: SKU = makeSku({
  skuId: 'CBL-1100-XLPE',
  productName: 'XLPE Armoured Power Cable 1100V',
  productCategory: 'Cables',
  productSubCategory: 'Power Cable',
  oemBrand: 'Polycab',
  specification: {
    standard: 'IS 7098',
    voltage: '1100 V',
    conductor: 'Aluminium',
    cores: '4',
  },
  availableQuantity: 5000,
  unitSalesPrice: 420,
  costPrice: 350,
  gstRate: 18,
  leadTime: 5,
});

/** Switchgear at a second warehouse, deliberately far from the first. */
export const SWITCHGEAR_SKU: SKU = makeSku({
  skuId: 'SWG-MCCB-250',
  productName: 'MCCB 250A Triple Pole',
  productCategory: 'Switchgear',
  productSubCategory: 'MCCB',
  oemBrand: 'Schneider',
  specification: {
    standard: 'IS 13947',
    current: '250 A',
    poles: '3',
  },
  availableQuantity: 40,
  warehouseLocation: 'Chennai, Tamil Nadu',
  warehouseCode: 'WH-CHN',
  warehouseLat: 13.0827,
  warehouseLon: 80.2707,
  unitSalesPrice: 18500,
  costPrice: 16000,
  gstRate: 18,
  leadTime: 10,
});

/** Out of stock, to exercise the zero-availability paths. */
export const OUT_OF_STOCK_SKU: SKU = makeSku({
  skuId: 'FAS-BOLT-M12',
  productName: 'Hex Bolt M12 Galvanised',
  productCategory: 'Fasteners',
  productSubCategory: 'Bolts',
  specification: { standard: 'IS 1367', size: '12 mm' },
  availableQuantity: 0,
  unitSalesPrice: 25,
  costPrice: 18,
});

/** No price on record — the financial agent must refuse to invent one. */
export const UNPRICED_SKU: SKU = makeSku({
  skuId: 'MISC-UNPRICED',
  productName: 'Unpriced Assembly',
  productCategory: 'Miscellaneous',
  unitSalesPrice: 0,
  costPrice: 0,
  availableQuantity: 10,
});

export const COMPANY_A_INVENTORY: SKU[] = [CABLE_SKU, SWITCHGEAR_SKU, OUT_OF_STOCK_SKU];

/** A second tenant's catalogue, with no overlap with company A's. */
export const COMPANY_B_INVENTORY: SKU[] = [
  makeSku({
    skuId: 'LAB-MICRO-01',
    productName: 'Binocular Microscope',
    productCategory: 'Laboratory Equipment',
    productSubCategory: 'Microscopes',
    specification: { magnification: '1000 x' },
    availableQuantity: 15,
    warehouseLocation: 'Pune, Maharashtra',
    warehouseCode: 'WH-PUN',
    warehouseLat: 18.5204,
    warehouseLon: 73.8567,
    unitSalesPrice: 32000,
    costPrice: 27000,
  }),
];
