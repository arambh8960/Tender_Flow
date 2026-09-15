import { describe, it, expect } from 'vitest';
import runFinancialAgent, { type CommercialSettings } from '../../server/agents/financialagent';
import type { LineItemTechnicalAnalysis, ParsedRfpData, RfpProductLineItem } from '../../types';
import { makeSku } from '../fixtures/inventory.fixture';

/**
 * Organisation-specific financial configuration.
 *
 * The defect these lock down: GST, EMD, ePBG and the transport buffer used to
 * be literals in the settings loader, so one company's commercial assumptions
 * priced every tenant's bids. Two organisations with different defaults must
 * now produce different numbers for the same tender.
 */

const SKU = makeSku({
  skuId: 'ORG-CFG-1',
  productName: 'Configurable Widget',
  unitSalesPrice: 1_000,
  costPrice: 800,
  // No GST on the SKU, so the organisation default is what applies.
  gstRate: undefined as unknown as number,
  availableQuantity: 500,
});

const analysis: LineItemTechnicalAnalysis = {
  rfpLineItem: { name: 'Configurable Widget', quantity: 100, technicalSpecs: [] } as RfpProductLineItem,
  selectedSku: SKU,
  status: 'COMPLETE',
  matchPercentage: 90,
  technicalReasoning: 'fixture',
  complianceChecks: [],
  top3Recommendations: [],
};

/** A tender that states nothing, so every default is exercised. */
function silentTender(): ParsedRfpData {
  return {
    metadata: {
      bidNumber: 'GEM/ORG/CFG',
      issuingOrganization: 'Buyer',
      bidType: 'Bid',
      bidEndDate: new Date(Date.now() + 86_400_000 * 30).toISOString(),
      offerValidity: 90,
    },
    products: [],
    mandatoryDocuments: [],
  } as unknown as ParsedRfpData;
}

function settingsFor(overrides: Partial<CommercialSettings>): CommercialSettings {
  return {
    assumedDistanceKm: 100,
    ratePerKm: 50,
    distanceIsEstimate: true,
    transportBufferPercent: 10,
    defaultEmdPercent: 2,
    defaultEpbgPercent: 3,
    defaultGstRate: 18,
    ...overrides,
  };
}

describe('financial output follows the organisation, not a constant', () => {
  it('applies each organisation GST default to the same tender', () => {
    const standard = runFinancialAgent([analysis], silentTender(), settingsFor({ defaultGstRate: 18 }));
    const reduced = runFinancialAgent([analysis], silentTender(), settingsFor({ defaultGstRate: 5 }));

    // 100,000 base either way; only the tenant's rate differs.
    expect(standard.breakdown.materialBase).toBe(100_000);
    expect(reduced.breakdown.materialBase).toBe(100_000);

    expect(standard.breakdown.gst).toBe(18_000);
    expect(reduced.breakdown.gst).toBe(5_000);
    expect(standard.breakdown.finalValue).not.toBe(reduced.breakdown.finalValue);
  });

  it('applies each organisation EMD and ePBG default', () => {
    const cautious = runFinancialAgent(
      [analysis],
      silentTender(),
      settingsFor({ defaultEmdPercent: 5, defaultEpbgPercent: 10 })
    );
    const lean = runFinancialAgent(
      [analysis],
      silentTender(),
      settingsFor({ defaultEmdPercent: 1, defaultEpbgPercent: 2 })
    );

    expect(cautious.breakdown.emd).toBe(5_000);
    expect(cautious.breakdown.epbg).toBe(10_000);
    expect(lean.breakdown.emd).toBe(1_000);
    expect(lean.breakdown.epbg).toBe(2_000);
  });

  it('applies each organisation transport buffer', () => {
    const tight = runFinancialAgent([analysis], silentTender(), settingsFor({ transportBufferPercent: 0 }));
    const generous = runFinancialAgent([analysis], silentTender(), settingsFor({ transportBufferPercent: 50 }));

    // 100 km x ₹50 = ₹5,000 before the buffer.
    expect(tight.breakdown.logistics).toBe(5_000);
    expect(generous.breakdown.logistics).toBe(7_500);
  });

  it('applies each organisation freight rate', () => {
    const cheap = runFinancialAgent([analysis], silentTender(), settingsFor({ ratePerKm: 10 }));
    const costly = runFinancialAgent([analysis], silentTender(), settingsFor({ ratePerKm: 100 }));

    expect(cheap.breakdown.logistics).toBeLessThan(costly.breakdown.logistics);
  });

  it('records which source each assumption came from', () => {
    const result = runFinancialAgent([analysis], silentTender(), settingsFor({}));

    const emd = result.assumptions.find(a => a.field === 'emd');
    const rate = result.assumptions.find(a => a.field === 'logistics_rate_per_km');

    // A reader must be able to tell a configured value from a stated one.
    expect(emd?.source).toBe('organization');
    expect(rate?.source).toBe('organization');
  });

  it("lets a tender's own stated figure override the organisation default", () => {
    const tender = silentTender();
    (tender.metadata as Record<string, unknown>).emdAmount = 12_345;

    const result = runFinancialAgent([analysis], tender, settingsFor({ defaultEmdPercent: 50 }));

    // The tender wins; the default is only a fallback.
    expect(result.breakdown.emd).toBe(12_345);
    expect(result.assumptions.find(a => a.field === 'emd')?.source).toBe('tender');
  });

  it("lets a SKU's own GST rate override the organisation default", () => {
    const taxed = { ...analysis, selectedSku: makeSku({ ...SKU, gstRate: 12 }) };
    const result = runFinancialAgent([taxed], silentTender(), settingsFor({ defaultGstRate: 28 }));

    expect(result.lineItems[0].gstRate).toBe(12);
    expect(result.breakdown.gst).toBe(12_000);
  });

  it('stays deterministic for a given organisation configuration', () => {
    const settings = settingsFor({ defaultGstRate: 12, defaultEmdPercent: 4 });
    const baseline = JSON.stringify(runFinancialAgent([analysis], silentTender(), settings).breakdown);

    for (let run = 0; run < 10; run++) {
      expect(JSON.stringify(runFinancialAgent([analysis], silentTender(), settings).breakdown)).toBe(baseline);
    }
  });
});
