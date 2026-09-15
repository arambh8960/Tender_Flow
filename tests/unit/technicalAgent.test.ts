import { describe, it, expect, vi } from 'vitest';
import {
  runTechnicalAgent,
  scoreCandidate,
  evaluateRequirement,
  tokenOverlap,
  tokenize,
} from '../../server/agents/technicalagent';
import type { RfpProductLineItem } from '../../types';
import { CABLE_SKU, SWITCHGEAR_SKU, OUT_OF_STOCK_SKU, makeSku, COMPANY_A_INVENTORY } from '../fixtures/inventory.fixture';

/**
 * Technical agent tests.
 *
 * The behaviour under scrutiny is evidence: a requirement may only be
 * reported as MATCHED when a specific SKU attribute satisfies it. The
 * previous implementation set `verified: true` on every requirement whenever
 * the aggregate score passed 50, and floored every score at 30 so unrelated
 * products still cleared the qualification threshold.
 */

function item(overrides: Partial<RfpProductLineItem> = {}): RfpProductLineItem {
  return {
    name: 'XLPE Armoured Power Cable 1100V',
    quantity: 100,
    technicalSpecs: [],
    ...overrides,
  } as RfpProductLineItem;
}

describe('technical agent — matching', () => {
  it('matches an exactly-named product with high confidence', () => {
    const { itemAnalyses } = runTechnicalAgent([item()], COMPANY_A_INVENTORY);

    expect(itemAnalyses[0].selectedSku?.skuId).toBe(CABLE_SKU.skuId);
    expect(itemAnalyses[0].matchPercentage).toBeGreaterThan(50);
  });

  it('reports a partial match as PARTIAL rather than COMPLETE', () => {
    const analysis = runTechnicalAgent(
      [item({ name: 'Power Cable', technicalSpecs: ['IS 7098', '11000 V'] })],
      [CABLE_SKU]
    ).itemAnalyses[0];

    expect(['PARTIAL', 'NONE']).toContain(analysis.status);
  });

  it('selects nothing when no SKU is relevant', () => {
    const analysis = runTechnicalAgent([item({ name: 'Hospital Bed Linen' })], COMPANY_A_INVENTORY).itemAnalyses[0];

    expect(analysis.status).toBe('NONE');
    expect(analysis.selectedSku).toBeNull();
  });

  it('does not floor an unrelated product at a passing score', () => {
    const analysis = runTechnicalAgent([item({ name: 'Hospital Bed Linen' })], COMPANY_A_INVENTORY).itemAnalyses[0];

    // The old 30% safety floor let this clear a 15% threshold.
    expect(analysis.matchPercentage).toBeLessThan(25);
  });

  it('returns the top three recommendations, best first', () => {
    const analysis = runTechnicalAgent([item({ name: 'Cable' })], COMPANY_A_INVENTORY).itemAnalyses[0];

    expect(analysis.top3Recommendations.length).toBeLessThanOrEqual(3);
    const scores = analysis.top3Recommendations.map((r: { matchPercentage: number }) => r.matchPercentage);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe('technical agent — compliance evidence', () => {
  it('marks a standard MATCHED only when a SKU attribute declares it', () => {
    const check = evaluateRequirement('Conforming to IS 7098', CABLE_SKU);

    expect(check.status).toBe('MATCHED');
    expect(check.source).toBe('standard');
    expect(check.detectedValue).toContain('IS 7098');
    expect(check.evidence).toMatch(/IS 7098/);
  });

  it('marks a conflicting standard as MISMATCH, not as missing', () => {
    const check = evaluateRequirement('Must conform to IS 1554', CABLE_SKU);

    expect(check.status).toBe('MISMATCH');
    expect(check.detectedValue).toContain('IS 7098');
  });

  it('marks an unrecorded standard NOT_FOUND rather than assuming compliance', () => {
    const bare = makeSku({ ...CABLE_SKU, specification: { conductor: 'Aluminium' } });
    const check = evaluateRequirement('Conforming to IS 7098', bare);

    expect(check.status).toBe('NOT_FOUND');
    expect(check.detectedValue).toBeNull();
  });

  it('never reports a requirement as verified without evidence', () => {
    const { itemAnalyses } = runTechnicalAgent(
      [item({ technicalSpecs: ['IS 7098', 'Fire retardant low smoke', 'Operating temperature 90 C'] })],
      [CABLE_SKU]
    );

    for (const check of itemAnalyses[0].complianceChecks) {
      if (check.status === 'MATCHED') {
        expect(check.source).not.toBeNull();
        expect(check.detectedValue).not.toBeNull();
      } else {
        // Anything not matched must not be presented as confirmed.
        expect(check.detectedValue === null || check.status !== 'MATCHED').toBe(true);
      }
      // The old shape carried a blanket boolean; it must be gone.
      expect((check as unknown as { verified?: boolean }).verified).toBeUndefined();
    }
  });

  it('matches a numeric specification on value and unit', () => {
    const check = evaluateRequirement('Rated current 250 A', SWITCHGEAR_SKU);
    expect(check.status).toBe('MATCHED');
    expect(check.source).toBe('current');
  });

  it('flags a near-miss measurement for review instead of accepting it', () => {
    const check = evaluateRequirement('Rated current 260 A', SWITCHGEAR_SKU);
    expect(check.status).toBe('REQUIRES_REVIEW');
    expect(check.confidence).toBeLessThan(0.8);
  });

  it('rejects a measurement that is plainly wrong', () => {
    const check = evaluateRequirement('Rated current 630 A', SWITCHGEAR_SKU);
    expect(check.status).toBe('MISMATCH');
  });
});

describe('technical agent — mandatory specification conflicts', () => {
  it('caps a candidate that conflicts on a mandatory standard below the match threshold', () => {
    const candidate = scoreCandidate(
      item({ name: 'XLPE Armoured Power Cable 1100V', technicalSpecs: ['IS 1554'] }),
      CABLE_SKU
    );

    expect(candidate.blockingMismatches).toContain('IS 1554');
    expect(candidate.matchPercentage).toBeLessThan(25);
  });

  it('does not recommend a SKU on name overlap alone when a standard conflicts', () => {
    const analysis = runTechnicalAgent(
      [item({ name: 'XLPE Armoured Power Cable 1100V', technicalSpecs: ['IS 1554'] })],
      [CABLE_SKU]
    ).itemAnalyses[0];

    expect(analysis.status).toBe('NONE');
    expect(analysis.selectedSku).toBeNull();
  });
});

describe('technical agent — quantity and stock', () => {
  it('raises a shortfall risk when stock is below the requirement', () => {
    const short = makeSku({ ...CABLE_SKU, availableQuantity: 10 });
    const { riskEntries } = runTechnicalAgent([item({ quantity: 500 })], [short]);

    expect(riskEntries.some((r: { statement: string }) => /shortfall/i.test(r.statement))).toBe(true);
  });

  it('does not award COMPLETE when stock cannot cover the quantity', () => {
    const short = makeSku({ ...CABLE_SKU, availableQuantity: 1 });
    const analysis = runTechnicalAgent([item({ quantity: 500 })], [short]).itemAnalyses[0];

    expect(analysis.status).not.toBe('COMPLETE');
  });

  it('treats zero stock as a high risk', () => {
    const { riskEntries } = runTechnicalAgent(
      [item({ name: 'Hex Bolt M12 Galvanised', quantity: 100 })],
      [OUT_OF_STOCK_SKU]
    );
    expect(riskEntries.some((r: { riskLevel: string }) => r.riskLevel === 'High')).toBe(true);
  });

  it('ignores archived inventory', () => {
    const archived = makeSku({ ...CABLE_SKU, isActive: false });
    const analysis = runTechnicalAgent([item()], [archived]).itemAnalyses[0];

    expect(analysis.selectedSku).toBeNull();
  });
});

describe('technical agent — determinism', () => {
  it('never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    runTechnicalAgent([item()], COMPANY_A_INVENTORY);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('produces identical results across repeated runs', () => {
    const run = () => JSON.stringify(runTechnicalAgent([item({ technicalSpecs: ['IS 7098'] })], COMPANY_A_INVENTORY));
    const first = run();
    for (let i = 0; i < 5; i++) expect(run()).toBe(first);
  });

  it('ranks tied candidates in a stable order regardless of input order', () => {
    const a = makeSku({ ...CABLE_SKU, skuId: 'AAA' });
    const b = makeSku({ ...CABLE_SKU, skuId: 'BBB' });

    const forward = runTechnicalAgent([item()], [a, b]).itemAnalyses[0].selectedSku?.skuId;
    const reverse = runTechnicalAgent([item()], [b, a]).itemAnalyses[0].selectedSku?.skuId;
    expect(forward).toBe(reverse);
  });
});

describe('technical agent — text helpers', () => {
  it('drops filler words when tokenising', () => {
    expect(tokenize('Supply of the Cable for all units')).not.toContain('the');
    expect(tokenize('Supply of the Cable for all units')).toContain('cable');
  });

  it('measures overlap against the requirement, not the shorter string', () => {
    // A two-word category must not score full marks against a long, specific
    // requirement it barely relates to.
    const overlap = tokenOverlap(tokenize('xlpe armoured power cable 1100v four core'), tokenize('cables'));
    expect(overlap).toBeLessThan(0.5);
  });
});
