import { describe, it, expect, vi } from 'vitest';
import runFinancialAgent, {
  gemTransactionFee,
  calculateSecurityDeposit,
  round,
  type CommercialSettings,
} from '../../server/agents/financialagent';
import type { LineItemTechnicalAnalysis, ParsedRfpData, SKU } from '../../types';
import { CABLE_SKU, UNPRICED_SKU, OUT_OF_STOCK_SKU, makeSku } from '../fixtures/inventory.fixture';

/**
 * Financial agent tests.
 *
 * Every figure the agent produces is arithmetic over tender data, the
 * organisation's configuration and the selected SKU. These tests pin that
 * down — including the cases where the correct behaviour is to refuse to
 * produce a number.
 */

function settings(overrides: Partial<CommercialSettings> = {}): CommercialSettings {
  return {
    assumedDistanceKm: 400,
    ratePerKm: 55,
    distanceIsEstimate: true,
    transportBufferPercent: 10,
    defaultEmdPercent: 2,
    defaultEpbgPercent: 3,
    defaultGstRate: 18,
    ...overrides,
  };
}

function rfp(overrides: Partial<ParsedRfpData> = {}): ParsedRfpData {
  return {
    metadata: {
      bidNumber: 'GEM/2026/B/1',
      issuingOrganization: 'Test Buyer',
      bidType: 'Bid',
      bidEndDate: new Date(Date.now() + 86_400_000 * 20).toISOString(),
      offerValidity: 90,
    },
    products: [],
    mandatoryDocuments: [],
    ...overrides,
  } as ParsedRfpData;
}

function lineItem(sku: SKU | null, quantity: number, name = 'Power Cable'): LineItemTechnicalAnalysis {
  return {
    rfpLineItem: { name, quantity, technicalSpecs: [] } as never,
    selectedSku: sku,
    status: sku ? 'COMPLETE' : 'NONE',
    matchPercentage: sku ? 90 : 0,
    technicalReasoning: 'fixture',
    complianceChecks: [],
    top3Recommendations: [],
  };
}

describe('financial agent — GST', () => {
  it('applies the SKU GST rate to the line base', () => {
    const result = runFinancialAgent([lineItem(CABLE_SKU, 100)], rfp(), settings());

    expect(result.breakdown.materialBase).toBe(42_000); // 420 x 100
    expect(result.breakdown.gst).toBe(7_560); // 18% of 42,000
  });

  it('falls back to the organisation default when the SKU has no rate, and says so', () => {
    // An absent rate, not a genuine 0% one: a real zero is respected.
    const noGst = makeSku({ ...CABLE_SKU, gstRate: undefined as unknown as number });
    const result = runFinancialAgent([lineItem(noGst, 10)], rfp(), settings({ defaultGstRate: 12 }));

    expect(result.lineItems[0].gstRate).toBe(12);
    expect(result.validation.warnings.join(' ')).toMatch(/GST/i);
  });
});

describe('financial agent — GeM transaction fee', () => {
  it('charges nothing at or below ₹10 lakh', () => {
    expect(gemTransactionFee(0)).toBe(0);
    expect(gemTransactionFee(999_999)).toBe(0);
    expect(gemTransactionFee(1_000_000)).toBe(0);
  });

  it('charges 0.30% between ₹10 lakh and ₹10 crore', () => {
    expect(gemTransactionFee(2_000_000)).toBe(6_000);
    expect(gemTransactionFee(100_000_000)).toBe(300_000);
  });

  it('caps at ₹3,00,000 above ₹10 crore', () => {
    expect(gemTransactionFee(500_000_000)).toBe(300_000);
  });

  it('returns zero for invalid input rather than NaN', () => {
    expect(gemTransactionFee(Number.NaN)).toBe(0);
    expect(gemTransactionFee(-5)).toBe(0);
  });
});

describe('financial agent — EMD and ePBG', () => {
  it('uses an exact EMD amount stated in the tender', () => {
    const tender = rfp({ metadata: { ...rfp().metadata, emdAmount: 50_000 } as never });
    const { amount, assumption } = calculateSecurityDeposit(tender, 'emd', 1_000_000, settings());

    expect(amount).toBe(50_000);
    expect(assumption.source).toBe('tender');
  });

  it('uses a percentage stated in the tender for ePBG', () => {
    const tender = rfp({ metadata: { ...rfp().metadata, epbgPercent: 5 } as never });
    const { amount, assumption } = calculateSecurityDeposit(tender, 'epbg', 1_000_000, settings());

    expect(amount).toBe(50_000);
    expect(assumption.source).toBe('tender');
  });

  it('falls back to the organisation default and labels it as such', () => {
    const { amount, assumption } = calculateSecurityDeposit(rfp(), 'emd', 1_000_000, settings({ defaultEmdPercent: 2 }));

    expect(amount).toBe(20_000);
    expect(assumption.source).toBe('organization');
  });

  it('charges nothing when the tender says none is required', () => {
    const tender = rfp({ financialConditions: { emd: 'Not Required', epbg: 'Not Required' } as never });
    expect(calculateSecurityDeposit(tender, 'emd', 1_000_000, settings()).amount).toBe(0);
    expect(calculateSecurityDeposit(tender, 'epbg', 1_000_000, settings()).amount).toBe(0);
  });
});

describe('financial agent — logistics', () => {
  it('applies the transport buffer to the configured rate and distance', () => {
    const result = runFinancialAgent([lineItem(CABLE_SKU, 10)], rfp(), settings({ assumedDistanceKm: 100, ratePerKm: 50 }));

    // 100 km x ₹50 = ₹5,000, plus a 10% buffer.
    expect(result.breakdown.logistics).toBe(5_500);
  });

  it('prefers a measured distance and marks it as measured', () => {
    const result = runFinancialAgent(
      [lineItem(CABLE_SKU, 10)],
      rfp(),
      settings({ assumedDistanceKm: 400, measuredDistanceKm: 120, measuredFromWarehouse: 'WH-JAL' })
    );

    const distance = result.assumptions.find(a => a.field === 'logistics_distance_km');
    expect(distance?.value).toBe(120);
    expect(distance?.note).toMatch(/Measured from WH-JAL/);
  });

  it('labels a configured average as an estimate, never as a measurement', () => {
    const result = runFinancialAgent([lineItem(CABLE_SKU, 10)], rfp(), settings({ assumedDistanceKm: 400 }));
    const distance = result.assumptions.find(a => a.field === 'logistics_distance_km');

    expect(distance?.note).toMatch(/ESTIMATE/);
    expect(result.summary.recommendation).toMatch(/ESTIMATED/);
  });

  it('warns rather than silently zeroing freight when no distance is available', () => {
    const result = runFinancialAgent([lineItem(CABLE_SKU, 10)], rfp(), settings({ assumedDistanceKm: 0 }));

    expect(result.breakdown.logistics).toBe(0);
    expect(result.validation.warnings.join(' ')).toMatch(/distance/i);
  });
});

describe('financial agent — multiple line items and totals', () => {
  it('sums several line items into one bid value', () => {
    const second = makeSku({ ...CABLE_SKU, skuId: 'CBL-2', unitSalesPrice: 1_000, gstRate: 18 });
    const result = runFinancialAgent(
      [lineItem(CABLE_SKU, 100), lineItem(second, 50, 'Control Cable')],
      rfp(),
      settings()
    );

    expect(result.lineItems).toHaveLength(2);
    expect(result.breakdown.materialBase).toBe(42_000 + 50_000);

    const { materialBase, gst, logistics, brokerage, emd, epbg, otherCosts, finalValue } = result.breakdown;
    expect(finalValue).toBe(round(materialBase + gst + logistics + brokerage + emd + epbg + otherCosts));
  });
});

describe('financial agent — validation and refusal to invent', () => {
  it('flags a line item with no matched SKU for human review', () => {
    const result = runFinancialAgent([lineItem(null, 10, 'Unknown Widget')], rfp(), settings());

    expect(result.validation.requiresManualReview).toBe(true);
    expect(result.validation.blockingIssues.join(' ')).toMatch(/no matching SKU/i);
    expect(result.summary.finalBidValue).toBeGreaterThanOrEqual(0);
  });

  it('refuses to price a SKU with no recorded price instead of guessing one', () => {
    const result = runFinancialAgent([lineItem(UNPRICED_SKU, 10)], rfp(), settings());

    expect(result.lineItems[0].unitPrice).toBe(0);
    expect(result.validation.blockingIssues.join(' ')).toMatch(/no unit price/i);
    expect(result.validation.requiresManualReview).toBe(true);
  });

  it('flags a missing or unusable quantity', () => {
    const result = runFinancialAgent(
      [{ ...lineItem(CABLE_SKU, 0), rfpLineItem: { name: 'Cable', quantity: Number.NaN } as never }],
      rfp(),
      settings()
    );

    expect(result.validation.blockingIssues.join(' ')).toMatch(/quantity/i);
  });

  it('raises a risk entry when stock is short of the required quantity', () => {
    const result = runFinancialAgent([lineItem(OUT_OF_STOCK_SKU, 500)], rfp(), settings());

    const shortfall = result.riskEntries.find(r => /short by/i.test(r.statement));
    expect(shortfall).toBeDefined();
    expect(shortfall?.riskLevel).toBe('High');
    expect(result.lineItems[0].shortfall).toBe(500);
  });

  it('raises a risk when margin falls below the configured floor', () => {
    const thin = makeSku({ ...CABLE_SKU, costPrice: 415, unitSalesPrice: 420, minMarginPercent: 10 });
    const result = runFinancialAgent([lineItem(thin, 10)], rfp(), settings());

    expect(result.riskEntries.some(r => /margin/i.test(r.statement))).toBe(true);
  });

  it('reports zero inventory as requiring review rather than a zero bid', () => {
    const result = runFinancialAgent([], rfp(), settings());

    expect(result.validation.requiresManualReview).toBe(true);
    expect(result.summary.matchStatus).toBe('NONE');
  });

  it('handles very large amounts without losing precision in the total', () => {
    const large = makeSku({ ...CABLE_SKU, unitSalesPrice: 9_999_999, gstRate: 18 });
    const result = runFinancialAgent([lineItem(large, 1_000)], rfp(), settings());

    expect(result.breakdown.materialBase).toBe(9_999_999_000);
    expect(result.breakdown.brokerage).toBeGreaterThanOrEqual(300_000);
    expect(Number.isFinite(result.summary.finalBidValue)).toBe(true);
  });

  it('handles a zero-value bid without producing NaN anywhere', () => {
    const free = makeSku({ ...CABLE_SKU, unitSalesPrice: 0 });
    const result = runFinancialAgent([lineItem(free, 10)], rfp(), settings());

    for (const value of Object.values(result.breakdown)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('financial agent — determinism', () => {
  it('never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    runFinancialAgent([lineItem(CABLE_SKU, 100)], rfp(), settings());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('produces byte-identical output across repeated runs', () => {
    const run = () => JSON.stringify(runFinancialAgent([lineItem(CABLE_SKU, 137)], rfp(), settings()).breakdown);
    const first = run();
    for (let i = 0; i < 5; i++) expect(run()).toBe(first);
  });

  it('rounds currency to two decimal places', () => {
    const odd = makeSku({ ...CABLE_SKU, unitSalesPrice: 33.333, gstRate: 18 });
    const result = runFinancialAgent([lineItem(odd, 3)], rfp(), settings());

    expect(result.breakdown.materialBase).toBe(99.999999999999 ? round(33.333 * 3) : 0);
    expect(String(result.breakdown.gst).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});
