import type { SKU, TruckType } from '../../../types';
import type { NormalizedTender } from '../normalization/types';
import {
  resolveLocation,
  selectNearestWarehouse,
  roadDistanceKm,
  isUsableCoordinate,
  type Coordinates,
  type WarehouseCandidate,
} from '../../services/logistics/geo';

export interface LogisticsAssessment {
  score: number;
  distanceKm: number;
  /**
   * 'computed' — measured warehouse -> consignee distance.
   * 'assumed'  — the organisation's configured average haul, used only when
   *              the consignee location could not be resolved.
   * 'unknown'  — neither available; cost is not estimated at all.
   */
  distanceSource: 'computed' | 'assumed' | 'unknown';
  /** Which warehouse the distance was measured from, when it was measured. */
  selectedWarehouse: string | null;
  consigneeResolvedAs: string | null;
  ratePerKm: number;
  effectiveRatePerKm: number;
  estimatedCost: number;
  feasible: boolean;
  notes: string[];
}

export interface LogisticsSettings {
  /** Fallback only. Never used as a tender's actual distance. */
  assumedAvgKms: number;
  ratePerKm: number;
  /** Beyond this, delivery is treated as infeasible. Null disables the gate. */
  maxDistanceKm?: number | null;
  /** Days until closing within which the lead time must fit. */
  deliveryWindowDays?: number | null;
}

const TRUCK_RATE_MULTIPLIER: Record<TruckType, number> = {
  HEAVY_TRUCK: 1.0,
  MEDIUM_TRUCK: 0.7,
  LCV: 0.4,
  MINI_TRUCK: 0.3,
};

/** Distance beyond which a haul is treated as unviable unless configured otherwise. */
const DEFAULT_MAX_DISTANCE_KM = 2500;

/**
 * Freight feasibility.
 *
 * What changed: the previous implementation set `distance = assumedAvgKms`,
 * compared assumedAvgKms <= assumedAvgKms (a gate that was always true), and
 * reported the operator's configured average as though it were the tender's
 * real distance.
 *
 * Now the consignee location is resolved to coordinates, the nearest
 * warehouse holding matched stock is chosen, and the distance between them is
 * measured. The configured average survives only as an explicitly-labelled
 * fallback when the consignee cannot be resolved.
 */
export class LogisticsQualifier {
  constructor(private settings: LogisticsSettings) {}

  assess(tender: NormalizedTender, bestSku: SKU | null, candidates: SKU[] = []): LogisticsAssessment {
    const notes: string[] = [];
    const ratePerKm = this.settings.ratePerKm || 0;

    const multiplier = bestSku?.truckType ? TRUCK_RATE_MULTIPLIER[bestSku.truckType] ?? 1 : 1;
    const effectiveRatePerKm = Math.round(ratePerKm * multiplier * 100) / 100;

    if (!bestSku) notes.push('No matched SKU, so the vehicle class defaults to the base rate.');

    /* ── 1. where is the tender delivering to ───────────────────────────── */
    const destination = this.resolveDestination(tender, notes);

    /* ── 2. which of our warehouses is nearest ──────────────────────────── */
    const warehouses = this.warehouseCandidates(bestSku, candidates);

    let distanceKm = 0;
    let distanceSource: LogisticsAssessment['distanceSource'] = 'unknown';
    let selectedWarehouse: string | null = null;

    if (destination && warehouses.length > 0) {
      const selection = selectNearestWarehouse(destination.coordinates, warehouses);
      if (selection) {
        distanceKm = selection.distanceKm;
        distanceSource = 'computed';
        selectedWarehouse = selection.warehouse.code || selection.warehouse.location || null;
        notes.push(
          `Measured ${distanceKm} km from ${selectedWarehouse ?? 'the nearest warehouse'} to ${destination.matchedOn}` +
            (destination.precision === 'state' ? ' (state-level precision).' : '.')
        );
      }
    }

    if (distanceSource === 'unknown') {
      if (this.settings.assumedAvgKms > 0) {
        distanceKm = this.settings.assumedAvgKms;
        distanceSource = 'assumed';
        notes.push(
          `ESTIMATE — using the configured ${distanceKm} km average haul because the route could not be measured.`
        );
      } else {
        notes.push('Distance unknown and no average configured, so freight cost is not estimated.');
      }
    }

    const estimatedCost = distanceSource === 'unknown' ? 0 : Math.round(distanceKm * effectiveRatePerKm);

    /* ── 3. feasibility ─────────────────────────────────────────────────── */
    const maxDistance = this.settings.maxDistanceKm ?? DEFAULT_MAX_DISTANCE_KM;
    let feasible = true;

    if (distanceSource === 'computed' && maxDistance > 0 && distanceKm > maxDistance) {
      feasible = false;
      notes.push(`Consignee is ${distanceKm} km away, beyond the ${maxDistance} km delivery limit.`);
    }

    // Lead time has to fit inside the time left before the tender closes.
    const leadTimeDays = bestSku?.leadTime ?? null;
    const daysToClose = this.daysUntilClosing(tender);

    if (leadTimeDays !== null && daysToClose !== null && leadTimeDays > daysToClose) {
      feasible = false;
      notes.push(`Lead time of ${leadTimeDays} day(s) exceeds the ${daysToClose} day(s) until closing.`);
    }

    /* ── 4. score ───────────────────────────────────────────────────────── */
    const score = this.score(distanceKm, distanceSource, feasible);

    return {
      score,
      distanceKm,
      distanceSource,
      selectedWarehouse,
      consigneeResolvedAs: destination?.matchedOn ?? null,
      ratePerKm,
      effectiveRatePerKm,
      estimatedCost,
      feasible,
      notes,
    };
  }

  /** Consignee coordinates: explicit ones if the portal gave them, else resolved from text. */
  private resolveDestination(tender: NormalizedTender, notes: string[]) {
    if (isUsableCoordinate(tender.latitude) && isUsableCoordinate(tender.longitude)) {
      return {
        coordinates: { latitude: tender.latitude, longitude: tender.longitude } as Coordinates,
        matchedOn: tender.location ?? 'the tender coordinates',
        precision: 'city' as const,
      };
    }

    const resolved = resolveLocation(tender.location);
    if (!resolved) {
      notes.push(
        tender.location
          ? `Consignee location "${tender.location}" could not be resolved to coordinates.`
          : 'The tender does not state a consignee location.'
      );
      return null;
    }
    return resolved;
  }

  /**
   * Warehouses worth measuring from: those holding a matched SKU in stock.
   * Falls back to every matched SKU's warehouse when nothing is in stock, so
   * a procurement-led bid still gets a distance.
   */
  private warehouseCandidates(bestSku: SKU | null, candidates: SKU[]): WarehouseCandidate[] {
    const pool = candidates.length > 0 ? candidates : bestSku ? [bestSku] : [];
    const inStock = pool.filter(sku => sku.availableQuantity > 0);
    const considered = inStock.length > 0 ? inStock : pool;

    const seen = new Set<string>();
    const result: WarehouseCandidate[] = [];

    for (const sku of considered) {
      const code = sku.warehouseCode || sku.warehouseLocation || '';
      if (!code || seen.has(code)) continue;
      seen.add(code);

      const hasCoordinates = isUsableCoordinate(sku.warehouseLat) && isUsableCoordinate(sku.warehouseLon);
      result.push({
        code,
        location: sku.warehouseLocation || '',
        // A warehouse without coordinates is skipped by the selector rather
        // than defaulted to a location it might not be at.
        coordinates: hasCoordinates
          ? { latitude: sku.warehouseLat, longitude: sku.warehouseLon }
          : resolveLocation(sku.warehouseLocation)?.coordinates ?? null,
      });
    }

    return result;
  }

  private daysUntilClosing(tender: NormalizedTender): number | null {
    if (!tender.closingAt) return null;
    const closing = new Date(tender.closingAt).getTime();
    if (Number.isNaN(closing)) return null;
    return Math.floor((closing - Date.now()) / 86_400_000);
  }

  /**
   * Nearer is better. An assumed distance is capped below a measured one, so
   * an unresolved consignee can never outscore a genuinely short haul.
   */
  private score(distanceKm: number, source: LogisticsAssessment['distanceSource'], feasible: boolean): number {
    if (!feasible) return 0;
    if (source === 'unknown') return 40;

    const raw = Math.max(0, Math.min(100, Math.round(100 - distanceKm / 25)));
    return source === 'assumed' ? Math.min(raw, 70) : raw;
  }
}

export { roadDistanceKm };
