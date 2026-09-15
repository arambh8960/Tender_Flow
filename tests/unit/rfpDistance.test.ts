import { describe, it, expect } from 'vitest';
import { resolveDeliveryDistance } from '../../server/services/rfp/analysisPipeline';
import { haversineKm, ROAD_DISTANCE_FACTOR } from '../../server/services/logistics/geo';
import { CABLE_SKU, SWITCHGEAR_SKU, makeSku } from '../fixtures/inventory.fixture';

/**
 * RFP costing distance.
 *
 * The rule under test: the delivery distance used to price a bid must come
 * from real geography whenever the consignee can be located, and the
 * organisation's configured average may be used only when it cannot — and
 * only while labelled an estimate. A silent fall back to the average is the
 * specific failure this guards.
 */

// Independently computed reference points, not taken from the implementation.
const JALANDHAR = { latitude: 31.326, longitude: 75.5762 }; // WH-JAL
const CHENNAI = { latitude: 13.0827, longitude: 80.2707 }; // WH-CHN
const LUDHIANA = { latitude: 30.901, longitude: 75.8573 };

describe('RFP delivery distance', () => {
  it('measures from the warehouse holding the matched SKU', () => {
    const result = resolveDeliveryDistance('Ludhiana, Punjab', [CABLE_SKU]);

    expect(result).not.toBeNull();
    expect(result?.warehouse).toBe('WH-JAL');

    // Cross-check against an independently computed Haversine value.
    const expected = Math.round(haversineKm(JALANDHAR, LUDHIANA) * ROAD_DISTANCE_FACTOR * 10) / 10;
    expect(result?.distanceKm).toBe(expected);
  });

  it('picks the nearest of several warehouses, not the first', () => {
    const toChennai = resolveDeliveryDistance('Chennai, Tamil Nadu', [CABLE_SKU, SWITCHGEAR_SKU]);
    const toLudhiana = resolveDeliveryDistance('Ludhiana, Punjab', [CABLE_SKU, SWITCHGEAR_SKU]);

    expect(toChennai?.warehouse).toBe('WH-CHN');
    expect(toLudhiana?.warehouse).toBe('WH-JAL');
    expect(toChennai?.distanceKm).toBeLessThan(toLudhiana!.distanceKm + 1000);
  });

  it('returns null when the consignee cannot be located, rather than guessing', () => {
    expect(resolveDeliveryDistance('Plot 4, Sector 9 Extension', [CABLE_SKU])).toBeNull();
    expect(resolveDeliveryDistance('', [CABLE_SKU])).toBeNull();
    expect(resolveDeliveryDistance(null, [CABLE_SKU])).toBeNull();
    expect(resolveDeliveryDistance(undefined, [CABLE_SKU])).toBeNull();
  });

  it('returns null when no matched SKU has a locatable warehouse', () => {
    const nowhere = makeSku({
      skuId: 'NO-WH',
      warehouseCode: 'WH-???',
      warehouseLocation: 'Unlisted Depot',
      warehouseLat: 0,
      warehouseLon: 0,
    });
    expect(resolveDeliveryDistance('Chennai, Tamil Nadu', [nowhere])).toBeNull();
  });

  it('falls back to resolving the warehouse by name when coordinates are absent', () => {
    const byName = makeSku({
      skuId: 'NAMED-WH',
      warehouseCode: 'WH-PUNE',
      warehouseLocation: 'Pune, Maharashtra',
      warehouseLat: 0,
      warehouseLon: 0,
    });
    const result = resolveDeliveryDistance('Mumbai, Maharashtra', [byName]);

    expect(result?.warehouse).toBe('WH-PUNE');
    expect(result?.distanceKm).toBeGreaterThan(0);
  });

  it('ignores an empty SKU list', () => {
    expect(resolveDeliveryDistance('Chennai, Tamil Nadu', [])).toBeNull();
  });

  it('is deterministic across repeated calls', () => {
    const first = JSON.stringify(resolveDeliveryDistance('Ludhiana, Punjab', [CABLE_SKU, SWITCHGEAR_SKU]));
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(resolveDeliveryDistance('Ludhiana, Punjab', [CABLE_SKU, SWITCHGEAR_SKU]))).toBe(first);
    }
  });

  it('measures a long haul consistently with the great-circle reference', () => {
    const result = resolveDeliveryDistance('Chennai, Tamil Nadu', [CABLE_SKU]);
    const straightLine = haversineKm(JALANDHAR, CHENNAI);

    // Road distance exceeds the straight line but stays proportional to it.
    expect(result!.distanceKm).toBeGreaterThan(straightLine);
    expect(result!.distanceKm).toBeCloseTo(straightLine * ROAD_DISTANCE_FACTOR, 0);
  });
});
