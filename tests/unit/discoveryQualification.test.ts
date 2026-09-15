import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { TenderQualifier } from '../../server/discovery/qualification/TenderQualifier';
import { InventoryMatcher } from '../../server/discovery/qualification/InventoryMatcher';
import { LogisticsQualifier } from '../../server/discovery/qualification/LogisticsQualifier';
import { CommercialQualifier } from '../../server/discovery/qualification/CommercialQualifier';
import { Deduplicator } from '../../server/discovery/deduplication/Deduplicator';
import { GeMParser } from '../../server/discovery/portals/gem/GeMParser';

import {
  COMPANY_A_INVENTORY,
  COMPANY_B_INVENTORY,
  CABLE_SKU,
  SWITCHGEAR_SKU,
  OUT_OF_STOCK_SKU,
  makeSku,
} from '../fixtures/inventory.fixture';
import {
  makeTender,
  makeSettings,
  daysFromNow,
  QUALIFYING_TENDER,
  UNRELATED_TENDER,
  EXPIRED_TENDER,
  SAME_DAY_TENDER,
  MALFORMED_DATE_TENDER,
  EMD_TENDER,
  DISTANT_TENDER,
  UNPARSEABLE_TENDER,
  UNRESOLVABLE_LOCATION_TENDER,
} from '../fixtures/discovery.fixture';

const qualify = (tender = QUALIFYING_TENDER, inventory = COMPANY_A_INVENTORY, settings = makeSettings()) =>
  new TenderQualifier(inventory, settings).qualify(tender);

describe('discovery qualification — category matching', () => {
  it('1. scores an exact category match highly', () => {
    const result = qualify();
    expect(result.breakdown.inventory.match).toBe(true);
    expect(result.breakdown.inventory.confidence).toBeGreaterThanOrEqual(70);
    expect(result.isQualified).toBe(true);
  });

  it('2. still matches on a partial category overlap', () => {
    const tender = makeTender({
      matchableText: 'procurement of power cable accessories for substation',
      category: 'Power Cable',
    });
    const result = qualify(tender);
    expect(result.breakdown.inventory.match).toBe(true);
  });

  it('3. rejects a tender with no catalogue overlap', () => {
    const result = qualify(UNRELATED_TENDER);
    expect(result.breakdown.inventory.match).toBe(false);
    expect(result.isQualified).toBe(false);
    expect(result.reason).toMatch(/catalogue/i);
  });

  it('4. rejects everything when the catalogue is empty', () => {
    const result = qualify(QUALIFYING_TENDER, []);
    expect(result.breakdown.inventory.confidence).toBe(0);
    expect(result.isQualified).toBe(false);
  });

  it('gives one tenant no visibility of another tenant\'s catalogue relevance', () => {
    // Company B stocks laboratory equipment; company A's cable tender must
    // not qualify against it.
    const result = qualify(QUALIFYING_TENDER, COMPANY_B_INVENTORY);
    expect(result.isQualified).toBe(false);
  });
});

describe('discovery qualification — stock', () => {
  it('5. reports zero stock as procurement required', () => {
    const tender = makeTender({ matchableText: 'supply of hex bolt m12 galvanised fasteners bolts' });
    const result = qualify(tender, [OUT_OF_STOCK_SKU]);
    expect(result.breakdown.inventory.inStock).toBe(false);
    expect(result.breakdown.inventory.procurementRequired).toBe(true);
  });

  it('6. reports partial stock as available', () => {
    const partial = makeSku({ ...CABLE_SKU, availableQuantity: 5 });
    const result = qualify(QUALIFYING_TENDER, [partial]);
    expect(result.breakdown.inventory.inStock).toBe(true);
    expect(result.breakdown.inventory.quantityAvailable).toBe(5);
  });

  it('7. reports full stock', () => {
    const result = qualify();
    expect(result.breakdown.inventory.inStock).toBe(true);
    expect(result.breakdown.inventory.quantityAvailable).toBeGreaterThan(0);
  });
});

describe('discovery qualification — technical specifications', () => {
  it('8. handles a SKU with no recorded specifications', () => {
    const bare = makeSku({ ...CABLE_SKU, specification: {} });
    const result = qualify(QUALIFYING_TENDER, [bare]);
    expect(result.scores.technical_score).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.scores.technical_score)).toBe(true);
  });

  it('9. does not claim a standards match when the tender names a different standard', () => {
    const tender = makeTender({ matchableText: 'supply of power cable conforming to iso 9001 certification' });
    const result = qualify(tender, COMPANY_A_INVENTORY, makeSettings({ validCertificates: [] }));
    expect(result.breakdown.compliance.missing).toContain('iso 9001');
  });

  it('10. credits a standard the organisation actually holds', () => {
    const tender = makeTender({ matchableText: 'supply of power cable with iso 9001 certified vendor' });
    const result = qualify(tender, COMPANY_A_INVENTORY, makeSettings({ validCertificates: ['ISO 9001:2015'] }));
    expect(result.breakdown.compliance.missing).toHaveLength(0);
    expect(result.breakdown.compliance.score).toBe(100);
  });

  it('11. records a missing standard rather than assuming it', () => {
    const tender = makeTender({ matchableText: 'cables requiring bis and iec marking' });
    const result = qualify(tender, COMPANY_A_INVENTORY, makeSettings({ validCertificates: ['BIS'] }));
    expect(result.breakdown.compliance.missing).toContain('iec');
    expect(result.breakdown.compliance.missing).not.toContain('bis');
  });
});

describe('discovery qualification — dates', () => {
  it('12. accepts a tender closing in the future', () => {
    expect(qualify(makeTender({ closingAt: daysFromNow(30) })).isQualified).toBe(true);
  });

  it('13. penalises an expired tender', () => {
    const result = qualify(EXPIRED_TENDER);
    // The lead time cannot fit into negative days remaining.
    expect(result.breakdown.logistics.feasible).toBe(false);
    expect(result.isQualified).toBe(false);
  });

  it('14. treats same-day closing as infeasible for a 5-day lead time', () => {
    const result = qualify(SAME_DAY_TENDER);
    expect(result.breakdown.logistics.feasible).toBe(false);
  });

  it('15. tolerates a malformed closing date without inventing one', () => {
    const result = qualify(MALFORMED_DATE_TENDER);
    expect(result.tender.closingAt).toBeNull();
    expect(Number.isFinite(result.scores.overall_score)).toBe(true);
  });

  it('16. tolerates a missing closing date', () => {
    const result = qualify(makeTender({ closingAt: undefined }));
    expect(Number.isFinite(result.scores.overall_score)).toBe(true);
  });
});

describe('discovery qualification — EMD policy', () => {
  it('17. rejects an EMD tender when EMD is disallowed', () => {
    const result = qualify(EMD_TENDER, COMPANY_A_INVENTORY, makeSettings({ allowEmd: false }));
    expect(result.isQualified).toBe(false);
    expect(result.reason).toMatch(/EMD/i);
    expect(result.breakdown.commercial.emdBlocked).toBe(true);
  });

  it('18. accepts an EMD tender when EMD is allowed', () => {
    const result = qualify(EMD_TENDER, COMPANY_A_INVENTORY, makeSettings({ allowEmd: true }));
    expect(result.breakdown.commercial.emdBlocked).toBe(false);
    expect(result.isQualified).toBe(true);
  });
});

describe('discovery deduplication', () => {
  it('19. collapses a duplicate bid id', () => {
    const first = makeTender({ externalId: 'GEM/2026/B/DUPE' });
    const second = makeTender({ externalId: 'GEM/2026/B/DUPE', title: 'Same bid, second page' });

    const { unique, duplicates } = Deduplicator.withinRun([first, second]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it('keeps genuinely distinct bids', () => {
    const { unique, duplicates } = Deduplicator.withinRun([
      makeTender({ externalId: 'A' }),
      makeTender({ externalId: 'B' }),
    ]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toBe(0);
  });
});

describe('discovery qualification — logistics and warehouses', () => {
  it('20. considers every warehouse holding matched stock', () => {
    const tender = makeTender({
      matchableText: 'supply of mccb 250a switchgear and xlpe power cable',
      location: 'Chennai, Tamil Nadu',
    });
    const result = qualify(tender, [CABLE_SKU, SWITCHGEAR_SKU]);
    expect(result.breakdown.logistics.distanceSource).toBe('computed');
  });

  it('21. selects the nearest warehouse to the consignee', () => {
    const chennaiTender = makeTender({
      matchableText: 'supply of mccb 250a switchgear triple pole',
      location: 'Chennai, Tamil Nadu',
    });
    const result = qualify(chennaiTender, [CABLE_SKU, SWITCHGEAR_SKU]);

    // Chennai warehouse, not the Punjab one 2000 km away.
    expect(result.breakdown.logistics.selectedWarehouse).toBe('WH-CHN');
    expect(result.breakdown.logistics.distanceKm).toBeLessThan(100);
  });

  it('22. marks a delivery beyond the configured limit as infeasible', () => {
    const result = qualify(
      DISTANT_TENDER,
      [CABLE_SKU],
      makeSettings({ maxDistanceKm: 500 })
    );
    expect(result.breakdown.logistics.feasible).toBe(false);
    expect(result.isQualified).toBe(false);
  });

  it('23. fails a tender whose lead time exceeds the time until closing', () => {
    const tight = makeTender({ closingAt: daysFromNow(2) });
    const slowSku = makeSku({ ...CABLE_SKU, leadTime: 30 });
    const result = qualify(tight, [slowSku]);
    expect(result.breakdown.logistics.feasible).toBe(false);
    expect(result.breakdown.logistics.notes.join(' ')).toMatch(/lead time/i);
  });

  it('falls back to the configured average ONLY when the consignee cannot be resolved', () => {
    const result = qualify(UNRESOLVABLE_LOCATION_TENDER, COMPANY_A_INVENTORY, makeSettings({ assumedAvgKms: 400 }));
    expect(result.breakdown.logistics.distanceSource).toBe('assumed');
    expect(result.breakdown.logistics.distanceKm).toBe(400);
    // The estimate is labelled as one, not presented as a measurement.
    expect(result.breakdown.logistics.notes.join(' ')).toMatch(/ESTIMATE/);
  });

  it('never presents the configured average as a measured distance', () => {
    const measured = qualify(QUALIFYING_TENDER, COMPANY_A_INVENTORY, makeSettings({ assumedAvgKms: 400 }));
    expect(measured.breakdown.logistics.distanceSource).toBe('computed');
    expect(measured.breakdown.logistics.distanceKm).not.toBe(400);
  });

  it('reports distance as unknown when neither a route nor an average exists', () => {
    const logistics = new LogisticsQualifier({ assumedAvgKms: 0, ratePerKm: 55 });
    const assessment = logistics.assess(UNRESOLVABLE_LOCATION_TENDER, null, []);
    expect(assessment.distanceSource).toBe('unknown');
    expect(assessment.estimatedCost).toBe(0);
  });
});

describe('discovery qualification — thresholds', () => {
  it('24. rejects a match below the configured threshold', () => {
    // Relevant enough to match, not relevant enough to clear the bar.
    const confidence = qualify().breakdown.inventory.confidence;
    const result = qualify(
      QUALIFYING_TENDER,
      COMPANY_A_INVENTORY,
      makeSettings({ minMatchThreshold: confidence + 1 })
    );
    expect(result.isQualified).toBe(false);
    expect(result.reason).toMatch(/threshold/i);
  });

  it('25. accepts a match exactly at the threshold boundary', () => {
    const result = qualify();
    const confidence = result.breakdown.inventory.confidence;

    const atBoundary = qualify(QUALIFYING_TENDER, COMPANY_A_INVENTORY, makeSettings({ minMatchThreshold: confidence }));
    expect(atBoundary.isQualified).toBe(true);

    const justAbove = qualify(
      QUALIFYING_TENDER,
      COMPANY_A_INVENTORY,
      makeSettings({ minMatchThreshold: confidence + 1 })
    );
    expect(justAbove.isQualified).toBe(false);
  });
});

describe('discovery scoring — determinism', () => {
  it('26. never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');

    new TenderQualifier(COMPANY_A_INVENTORY, makeSettings()).qualify(QUALIFYING_TENDER);
    new InventoryMatcher(COMPANY_A_INVENTORY).match(QUALIFYING_TENDER);
    new CommercialQualifier({ allowEmd: true }).assess(QUALIFYING_TENDER);
    new LogisticsQualifier({ assumedAvgKms: 400, ratePerKm: 55 }).assess(QUALIFYING_TENDER, CABLE_SKU, [CABLE_SKU]);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('27. produces identical output for identical input across repeated runs', () => {
    const runs = Array.from({ length: 5 }, () => qualify());

    const first = JSON.stringify(runs[0].scores);
    for (const run of runs) {
      expect(JSON.stringify(run.scores)).toBe(first);
      expect(run.isQualified).toBe(runs[0].isQualified);
      expect(run.reason).toBe(runs[0].reason);
      expect(run.breakdown.logistics.distanceKm).toBe(runs[0].breakdown.logistics.distanceKm);
      expect(run.breakdown.logistics.selectedWarehouse).toBe(runs[0].breakdown.logistics.selectedWarehouse);
    }
  });

  it('orders results identically when scores tie', () => {
    const a = makeSku({ skuId: 'AAA-1', productCategory: 'Cables', availableQuantity: 10 });
    const b = makeSku({ skuId: 'BBB-1', productCategory: 'Cables', availableQuantity: 10 });

    const first = new InventoryMatcher([a, b]).match(QUALIFYING_TENDER).matchedItems.map(m => m.sku.skuId);
    const second = new InventoryMatcher([b, a]).match(QUALIFYING_TENDER).matchedItems.map(m => m.sku.skuId);
    expect(first).toEqual(second);
  });
});

describe('discovery — malformed and missing scraper data', () => {
  it('28. scores an unparseable record at zero instead of matching a placeholder', () => {
    const result = qualify(UNPARSEABLE_TENDER);
    expect(result.breakdown.inventory.confidence).toBe(0);
    expect(result.isQualified).toBe(false);
    expect(result.breakdown.inventory.missingRequirements.join(' ')).toMatch(/parsed/i);
  });

  it('never substitutes a fallback organisation or category', () => {
    const parser = new GeMParser();
    const html = readFileSync(join(__dirname, '../fixtures/gem-pages/missing-fields.html'), 'utf8');
    const cards = parser.parseSearchResults(html);

    const serialised = JSON.stringify(cards);
    expect(serialised).not.toMatch(/Ministry of Defence/i);
    expect(serialised).not.toMatch(/Industrial Supply/i);
    expect(cards[0].orgName).toBe('');
    expect(cards[0].parseWarnings).toContain('org_name');
  });

  it('29. returns nothing for an empty portal response', () => {
    const parser = new GeMParser();
    expect(parser.parseSearchResults('')).toEqual([]);
    expect(parser.parseSearchResults('<html><body></body></html>')).toEqual([]);
  });
});
