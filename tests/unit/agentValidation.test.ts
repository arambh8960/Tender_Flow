import { describe, it, expect } from 'vitest';
import runFinancialAgent, { type CommercialSettings } from '../../server/agents/financialagent';
import { runTechnicalAgent, evaluateRequirement } from '../../server/agents/technicalagent';
import type { LineItemTechnicalAnalysis, ParsedRfpData, RfpProductLineItem, SKU } from '../../types';
import { makeSku } from '../fixtures/inventory.fixture';

/**
 * Agent validation against independently calculated expectations.
 *
 * Every expected figure below is worked out by hand in the comments rather
 * than read back from the implementation, so a change in agent behaviour
 * fails here instead of quietly redefining what "correct" means.
 */

/* ── the case under test ──────────────────────────────────────────────────
 * SKU        : unit price ₹2,000, GST 18%, cost ₹1,500, min margin 10%
 * Quantity   : 1,000
 * Distance   : 200 km at ₹50/km, 10% buffer
 * EMD        : tender states ₹40,000 exactly
 * ePBG       : tender states 5%
 *
 * material base = 2,000 × 1,000                     = 2,000,000
 * GST           = 2,000,000 × 0.18                  =   360,000
 * GeM fee       = 2,000,000 × 0.0030 (>10L, <=10Cr) =     6,000
 * logistics     = 200 × 50 × 1.10                   =    11,000
 * EMD           = stated exactly                    =    40,000
 * ePBG          = 2,000,000 × 0.05                  =   100,000
 * final         = sum of the above                  = 2,517,000
 * margin        = (2,000 − 1,500) / 2,000 = 25% ≥ 10% floor → no margin risk
 * ───────────────────────────────────────────────────────────────────────── */

const EXPECTED = {
  materialBase: 2_000_000,
  gst: 360_000,
  brokerage: 6_000,
  logistics: 11_000,
  emd: 40_000,
  epbg: 100_000,
  otherCosts: 0,
  finalValue: 2_517_000,
};

const PRICED_SKU: SKU = makeSku({
  skuId: 'VAL-SKU-1',
  productName: 'Validation Widget',
  productCategory: 'Widgets',
  unitSalesPrice: 2_000,
  costPrice: 1_500,
  gstRate: 18,
  minMarginPercent: 10,
  availableQuantity: 5_000,
});

function settings(): CommercialSettings {
  return {
    assumedDistanceKm: 200,
    ratePerKm: 50,
    distanceIsEstimate: true,
    transportBufferPercent: 10,
    defaultEmdPercent: 2,
    defaultEpbgPercent: 3,
    defaultGstRate: 18,
  };
}

function rfp(): ParsedRfpData {
  return {
    metadata: {
      bidNumber: 'GEM/2026/B/VALIDATION',
      issuingOrganization: 'Validation Buyer',
      bidType: 'Bid',
      bidEndDate: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      offerValidity: 90,
      emdAmount: 40_000,
      epbgPercent: 5,
    },
    products: [],
    mandatoryDocuments: [],
    consignee: 'Ludhiana, Punjab',
  } as unknown as ParsedRfpData;
}

const analysis: LineItemTechnicalAnalysis = {
  rfpLineItem: { name: 'Validation Widget', quantity: 1_000, technicalSpecs: [] } as RfpProductLineItem,
  selectedSku: PRICED_SKU,
  status: 'COMPLETE',
  matchPercentage: 95,
  technicalReasoning: 'validation fixture',
  complianceChecks: [],
  top3Recommendations: [],
};

describe('financial agent — independently calculated expectations', () => {
  const result = runFinancialAgent([analysis], rfp(), settings());

  it('computes the material base', () => {
    expect(result.breakdown.materialBase).toBe(EXPECTED.materialBase);
  });

  it('computes GST at the SKU rate', () => {
    expect(result.breakdown.gst).toBe(EXPECTED.gst);
  });

  it('computes the GeM transaction fee band correctly', () => {
    expect(result.breakdown.brokerage).toBe(EXPECTED.brokerage);
  });

  it('computes logistics including the buffer', () => {
    expect(result.breakdown.logistics).toBe(EXPECTED.logistics);
  });

  it('uses the exact EMD stated in the tender', () => {
    expect(result.breakdown.emd).toBe(EXPECTED.emd);
  });

  it('applies the ePBG percentage stated in the tender', () => {
    expect(result.breakdown.epbg).toBe(EXPECTED.epbg);
  });

  it('computes the final bid value as the sum of its parts', () => {
    expect(result.breakdown.finalValue).toBe(EXPECTED.finalValue);
    expect(result.summary.finalBidValue).toBe(EXPECTED.finalValue);
  });

  it('raises no margin risk when margin clears the configured floor', () => {
    expect(result.riskEntries.some(r => /margin/i.test(r.statement))).toBe(false);
  });

  it('does not demand human review for a complete, priced bid', () => {
    expect(result.validation.requiresManualReview).toBe(false);
    expect(result.validation.blockingIssues).toHaveLength(0);
  });

  it('produces byte-identical output across 20 consecutive runs', () => {
    const baseline = JSON.stringify(runFinancialAgent([{ ...analysis }], rfp(), settings()));

    for (let run = 1; run <= 20; run++) {
      const repeat = JSON.stringify(runFinancialAgent([{ ...analysis }], rfp(), settings()));
      expect(repeat, `run ${run} diverged from the baseline`).toBe(baseline);
    }
  });
});

/* ── technical agent: contradictory specifications ───────────────────────
 * Requirement : 10 HP motor, stainless steel, IS 9001
 * Inventory   :  7.5 HP motor, stainless steel, IS 9001
 *
 * Two of three requirements are satisfiable; the power rating conflicts.
 * The correct outcome is a recorded MISMATCH on power and no claim of full
 * compliance — not a high score carried by the two matching attributes.
 * ─────────────────────────────────────────────────────────────────────── */

const UNDERPOWERED_MOTOR: SKU = makeSku({
  skuId: 'MOT-7.5HP-SS',
  productName: 'Centrifugal Pump Motor',
  productCategory: 'Motors',
  productSubCategory: 'Centrifugal',
  specification: {
    power: '7.5 HP',
    material: 'stainless steel',
    standard: 'IS 9001',
  },
  availableQuantity: 50,
});

const MOTOR_REQUIREMENT: RfpProductLineItem = {
  name: 'Centrifugal Pump Motor',
  quantity: 10,
  technicalSpecs: ['10 HP', 'stainless steel', 'IS 9001'],
} as RfpProductLineItem;

describe('technical agent — contradictory specifications', () => {
  const { itemAnalyses } = runTechnicalAgent([MOTOR_REQUIREMENT], [UNDERPOWERED_MOTOR]);
  const analysisResult = itemAnalyses[0];

  it('never reports full compliance when a rating conflicts', () => {
    expect(analysisResult.status).not.toBe('COMPLETE');
  });

  it('records the power rating as an explicit mismatch', () => {
    const power = analysisResult.complianceChecks.find((c: { requirement: string }) => c.requirement === '10 HP');

    expect(power?.status).toBe('MISMATCH');
    expect(power?.detectedValue).toContain('7.5');
    expect(power?.evidence).toMatch(/7\.5.*10|10.*7\.5/);
  });

  it('still credits the requirements the SKU genuinely satisfies', () => {
    const material = analysisResult.complianceChecks.find((c: { requirement: string }) => c.requirement === 'stainless steel');
    const standard = analysisResult.complianceChecks.find((c: { requirement: string }) => c.requirement === 'IS 9001');

    expect(material?.status).toBe('MATCHED');
    expect(standard?.status).toBe('MATCHED');
  });

  it('attaches evidence to every satisfied requirement', () => {
    for (const check of analysisResult.complianceChecks) {
      if (check.status !== 'MATCHED') continue;
      expect(check.source, `"${check.requirement}" claimed MATCHED with no source attribute`).toBeTruthy();
      expect(check.detectedValue, `"${check.requirement}" claimed MATCHED with no detected value`).toBeTruthy();
    }
  });

  it('never carries a legacy blanket "verified" flag', () => {
    for (const check of analysisResult.complianceChecks) {
      expect((check as unknown as { verified?: boolean }).verified).toBeUndefined();
    }
  });

  it('flags the unresolved requirement as a technical risk', () => {
    const { riskEntries } = runTechnicalAgent([MOTOR_REQUIREMENT], [UNDERPOWERED_MOTOR]);
    expect(riskEntries.some((r: { category: string }) => r.category === 'Technical')).toBe(true);
  });

  it('treats an exactly-matching motor as compliant, proving the check discriminates', () => {
    const correct = makeSku({
      ...UNDERPOWERED_MOTOR,
      skuId: 'MOT-10HP-SS',
      specification: { power: '10 HP', material: 'stainless steel', standard: 'IS 9001' },
    });

    const power = evaluateRequirement('10 HP', correct);
    expect(power.status).toBe('MATCHED');

    const result = runTechnicalAgent([MOTOR_REQUIREMENT], [correct]).itemAnalyses[0];
    expect(result.status).toBe('COMPLETE');
  });

  it('is deterministic across 20 consecutive runs', () => {
    const baseline = JSON.stringify(runTechnicalAgent([MOTOR_REQUIREMENT], [UNDERPOWERED_MOTOR]));
    for (let run = 1; run <= 20; run++) {
      expect(JSON.stringify(runTechnicalAgent([MOTOR_REQUIREMENT], [UNDERPOWERED_MOTOR])), `run ${run}`).toBe(baseline);
    }
  });
});
