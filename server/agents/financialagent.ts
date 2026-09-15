import type { LineItemTechnicalAnalysis, SKU, ParsedRfpData, FinancialAgentResult } from '../../types';

/**
 * Financial agent — deterministic, company-aware costing.
 *
 * Every number here is arithmetic over tender data, the organisation's own
 * commercial configuration and the selected SKU's price. No LLM participates
 * in producing a value, and nothing falls back to one company's business
 * assumptions: rates arrive as CommercialSettings, loaded per tenant.
 *
 * Where an input is missing the agent does NOT invent one. It records the
 * gap, flags the result for human review, and leaves the affected component
 * at zero, because a plausible-looking bid built on a guessed price is worse
 * than an obviously incomplete one.
 */

export interface CommercialSettings {
  /** Configured average haul distance. An estimate, and labelled as one. */
  assumedDistanceKm: number;
  ratePerKm: number;
  distanceIsEstimate: boolean;
  transportBufferPercent: number;
  defaultEmdPercent: number;
  defaultEpbgPercent: number;
  defaultGstRate: number;
  /** Optional measured distance from the logistics service, when available. */
  measuredDistanceKm?: number | null;
  measuredFromWarehouse?: string | null;
}

export interface LineItemCosting {
  itemName: string;
  skuId: string | null;
  quantity: number;
  unitPrice: number;
  baseTotal: number;
  gstRate: number;
  gstAmount: number;
  availableQuantity: number | null;
  shortfall: number;
  issues: string[];
}

export interface FinancialBreakdown {
  materialBase: number;
  gst: number;
  logistics: number;
  brokerage: number;
  emd: number;
  epbg: number;
  otherCosts: number;
  finalValue: number;
}

export interface FinancialAssumption {
  field: string;
  value: string | number;
  source: 'tender' | 'organization' | 'sku' | 'statutory' | 'unavailable';
  note?: string;
}

export interface DetailedFinancialResult extends FinancialAgentResult {
  breakdown: FinancialBreakdown;
  lineItems: LineItemCosting[];
  assumptions: FinancialAssumption[];
  validation: {
    requiresManualReview: boolean;
    blockingIssues: string[];
    warnings: string[];
  };
}

/* GeM transaction charges — statutory, September 2024 guidelines. */
const GEM_FEE_LOWER_BOUND = 1_000_000; // ₹10 lakh
const GEM_FEE_UPPER_BOUND = 100_000_000; // ₹10 crore
const GEM_FEE_RATE = 0.003; // 0.30%
const GEM_FEE_CAP = 300_000;

export function round(value: number): number {
  // Bankers' problems aside, currency is stored to paise; rounding once at
  // each boundary keeps repeated runs bit-identical.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** GeM transaction fee, a pure function of order value. */
export function gemTransactionFee(orderValue: number): number {
  if (!isUsableNumber(orderValue) || orderValue <= GEM_FEE_LOWER_BOUND) return 0;
  if (orderValue <= GEM_FEE_UPPER_BOUND) return round(orderValue * GEM_FEE_RATE);
  return GEM_FEE_CAP;
}

/**
 * Security deposit (EMD/ePBG).
 *
 * Order of precedence: an explicit amount in the tender, then an explicit
 * percentage in the tender, then the organisation's configured default.
 * "Not Required" in the tender means zero, not the default.
 */
export function calculateSecurityDeposit(
  rfp: ParsedRfpData,
  type: 'emd' | 'epbg',
  base: number,
  settings: CommercialSettings
): { amount: number; assumption: FinancialAssumption } {
  const declared = rfp.financialConditions?.[type];
  if (declared === 'Not Required' || declared === 'No') {
    return {
      amount: 0,
      assumption: { field: `${type}`, value: 0, source: 'tender', note: 'Tender states it is not required.' },
    };
  }

  const explicitAmount = type === 'emd' ? rfp.metadata?.emdAmount : rfp.metadata?.epbgAmount;
  if (isUsableNumber(explicitAmount) && explicitAmount > 0) {
    return {
      amount: round(explicitAmount),
      assumption: { field: type, value: round(explicitAmount), source: 'tender', note: 'Exact amount stated in the tender.' },
    };
  }

  const explicitPercent = type === 'epbg' ? rfp.metadata?.epbgPercent : undefined;
  if (isUsableNumber(explicitPercent) && explicitPercent > 0) {
    return {
      amount: round(base * (explicitPercent / 100)),
      assumption: { field: type, value: `${explicitPercent}%`, source: 'tender', note: 'Percentage stated in the tender.' },
    };
  }

  const fallbackPercent = type === 'emd' ? settings.defaultEmdPercent : settings.defaultEpbgPercent;
  return {
    amount: round(base * (fallbackPercent / 100)),
    assumption: {
      field: type,
      value: `${fallbackPercent}%`,
      source: 'organization',
      note: 'Tender did not state a value; the organisation default was applied.',
    },
  };
}

export default function runFinancialAgent(
  analyses: LineItemTechnicalAnalysis[],
  rfpData: ParsedRfpData,
  settings: CommercialSettings,
  manualPriceOverrides?: Record<string, { unitPrice: number }>
): DetailedFinancialResult {
  const assumptions: FinancialAssumption[] = [];
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const riskEntries: FinancialAgentResult['riskEntries'] = [];
  const lineItems: LineItemCosting[] = [];

  let materialBase = 0;
  let gstTotal = 0;
  let brokerageFromSkus = 0;

  analyses.forEach((analysis, index) => {
    const item = analysis.rfpLineItem;
    const sku: SKU | null = analysis.selectedSku ?? null;
    const issues: string[] = [];
    const line = index + 1;

    const quantity = item?.quantity;
    if (!isUsableNumber(quantity) || quantity === 0) {
      issues.push('Quantity is missing or not a usable number.');
      blockingIssues.push(`Line ${line} (${item?.name ?? 'unnamed'}): quantity could not be determined.`);
    }
    if (isUsableNumber(quantity) && !Number.isInteger(quantity)) {
      warnings.push(`Line ${line}: quantity ${quantity} is fractional; verify the tender's unit of measure.`);
    }

    const override = manualPriceOverrides?.[item?.name ?? ''];
    let unitPrice = 0;
    let gstRate = settings.defaultGstRate;

    if (override && isUsableNumber(override.unitPrice)) {
      unitPrice = override.unitPrice;
      gstRate = isUsableNumber(sku?.gstRate) ? (sku as SKU).gstRate : settings.defaultGstRate;
      assumptions.push({ field: `line_${line}_unit_price`, value: unitPrice, source: 'organization', note: 'Manual price override.' });
    } else if (sku) {
      if (isUsableNumber(sku.unitSalesPrice) && sku.unitSalesPrice > 0) {
        unitPrice = sku.unitSalesPrice;
        assumptions.push({ field: `line_${line}_unit_price`, value: unitPrice, source: 'sku', note: `From ${sku.skuId}.` });
      } else {
        issues.push('The matched SKU has no sales price on record.');
        blockingIssues.push(`Line ${line} (${sku.skuId}): no unit price on record; the bid value is incomplete.`);
      }
      gstRate = isUsableNumber(sku.gstRate) ? sku.gstRate : settings.defaultGstRate;
      if (!isUsableNumber(sku.gstRate)) {
        warnings.push(`Line ${line}: SKU ${sku.skuId} has no GST rate; the organisation default of ${settings.defaultGstRate}% was applied.`);
      }
    } else {
      issues.push('No SKU was matched to this line item.');
      blockingIssues.push(`Line ${line} (${item?.name ?? 'unnamed'}): no matching SKU, so it cannot be priced.`);
    }

    const safeQuantity = isUsableNumber(quantity) ? quantity : 0;
    const baseTotal = round(unitPrice * safeQuantity);
    const gstAmount = round(baseTotal * (gstRate / 100));

    const availableQuantity = sku ? sku.availableQuantity : null;
    const shortfall =
      sku && isUsableNumber(quantity) ? Math.max(0, quantity - (sku.availableQuantity ?? 0)) : 0;

    if (sku && shortfall > 0) {
      riskEntries.push({
        category: 'Logistics',
        statement: `Line ${line}: ${sku.skuId} is short by ${shortfall} unit(s) — ${sku.availableQuantity ?? 0} available against ${quantity} required${sku.warehouseCode ? ` at ${sku.warehouseCode}` : ''}.`,
        riskLevel: (sku.availableQuantity ?? 0) === 0 ? 'High' : 'Medium',
      });
    }

    if (sku && isUsableNumber(sku.brokerage)) brokerageFromSkus += sku.brokerage * safeQuantity;

    // Margin check against the SKU's configured floor.
    if (sku && isUsableNumber(sku.costPrice) && sku.costPrice > 0 && unitPrice > 0) {
      const marginPercent = ((unitPrice - sku.costPrice) / unitPrice) * 100;
      if (isUsableNumber(sku.minMarginPercent) && marginPercent < sku.minMarginPercent) {
        riskEntries.push({
          category: 'Financial',
          statement: `Line ${line}: margin of ${marginPercent.toFixed(1)}% is below the ${sku.minMarginPercent}% floor configured for ${sku.skuId}.`,
          riskLevel: marginPercent < 0 ? 'High' : 'Medium',
        });
      }
    }

    materialBase += baseTotal;
    gstTotal += gstAmount;

    lineItems.push({
      itemName: item?.name ?? `Line ${line}`,
      skuId: sku?.skuId ?? null,
      quantity: safeQuantity,
      unitPrice: round(unitPrice),
      baseTotal,
      gstRate,
      gstAmount,
      availableQuantity,
      shortfall,
      issues,
    });

    // The analysis screen renders this per card; kept for UI compatibility.
    (analysis as LineItemTechnicalAnalysis & { financialBreakdown?: unknown }).financialBreakdown = {
      unitPrice: round(unitPrice),
      quantity: safeQuantity,
      baseTotal,
      gst: gstAmount,
      matchStatus: analysis.status,
    };
  });

  materialBase = round(materialBase);
  gstTotal = round(gstTotal);

  /* ── logistics ─────────────────────────────────────────────────────── */
  const measured = settings.measuredDistanceKm;
  const usingMeasured = isUsableNumber(measured) && measured > 0;
  const distanceKm = usingMeasured ? (measured as number) : settings.assumedDistanceKm;

  const baseTransport = round(distanceKm * settings.ratePerKm);
  const logistics = round(baseTransport * (1 + settings.transportBufferPercent / 100));

  assumptions.push({
    field: 'logistics_distance_km',
    value: distanceKm,
    source: usingMeasured ? 'organization' : settings.distanceIsEstimate ? 'unavailable' : 'organization',
    note: usingMeasured
      ? `Measured from ${settings.measuredFromWarehouse ?? 'the selected warehouse'}.`
      : 'ESTIMATE — configured average distance, not a measured route.',
  });
  assumptions.push({
    field: 'logistics_rate_per_km',
    value: settings.ratePerKm,
    source: 'organization',
  });

  if (!usingMeasured && distanceKm === 0) {
    warnings.push('No delivery distance is available, so logistics cost is zero. Configure an average distance or resolve the consignee location.');
  }
  if (settings.ratePerKm === 0) {
    warnings.push('The freight rate per km is zero, so logistics cost is not reflected in the bid.');
  }

  /* ── fees and deposits ─────────────────────────────────────────────── */
  const gemFee = gemTransactionFee(materialBase);
  assumptions.push({
    field: 'gem_transaction_fee',
    value: gemFee,
    source: 'statutory',
    note: 'GeM charges, September 2024 guidelines: nil up to ₹10L, 0.30% to ₹10Cr, capped at ₹3,00,000.',
  });

  const brokerage = round(gemFee + brokerageFromSkus);
  if (brokerageFromSkus > 0) {
    assumptions.push({ field: 'sku_brokerage', value: round(brokerageFromSkus), source: 'sku' });
  }

  const emd = calculateSecurityDeposit(rfpData, 'emd', materialBase, settings);
  const epbg = calculateSecurityDeposit(rfpData, 'epbg', materialBase, settings);
  assumptions.push(emd.assumption, epbg.assumption);

  const otherCosts = 0;
  const finalValue = round(materialBase + gstTotal + brokerage + logistics + emd.amount + epbg.amount + otherCosts);

  /* ── validation ────────────────────────────────────────────────────── */
  if (materialBase === 0) {
    blockingIssues.push('Material base cost is zero — nothing in this tender could be priced from inventory.');
  }
  if (analyses.length === 0) {
    blockingIssues.push('No line items were analysed.');
  }
  if (finalValue < 0) {
    blockingIssues.push('The computed bid value is negative, which indicates corrupt input data.');
  }

  const requiresManualReview = blockingIssues.length > 0;

  if (requiresManualReview) {
    riskEntries.push({
      category: 'Financial',
      statement: `Human review required before submission: ${blockingIssues[0]}`,
      riskLevel: 'High',
    });
  }

  const breakdown: FinancialBreakdown = {
    materialBase,
    gst: gstTotal,
    logistics,
    brokerage,
    emd: emd.amount,
    epbg: epbg.amount,
    otherCosts,
    finalValue,
  };

  return {
    pricing: {
      'Material Base Cost': materialBase,
      'Total GST Impact': gstTotal,
      "GeM Transaction Fee (Sept '24)": gemFee,
      [`Logistics (incl. ${settings.transportBufferPercent}% buffer)`]: logistics,
      'EPBG Provision': epbg.amount,
      'EMD Provision': emd.amount,
      'Final Bid Value': finalValue,
    },
    breakdown,
    lineItems,
    assumptions,
    validation: { requiresManualReview, blockingIssues, warnings },
    summary: {
      matchStatus: determineOverallStatus(analyses),
      confidenceScore: calculateConfidence(analyses),
      requiresManualInput: requiresManualReview,
      recommendation: requiresManualReview
        ? `Not submission-ready: ${blockingIssues.length} issue(s) require human review.`
        : `Bid computed at ₹${finalValue.toLocaleString('en-IN')} across ${lineItems.length} line item(s)${
            usingMeasured ? '' : ', using an ESTIMATED delivery distance'
          }.`,
      finalBidValue: finalValue,
    },
    riskEntries,
  };
}

function determineOverallStatus(analyses: LineItemTechnicalAnalysis[]): 'COMPLETE' | 'PARTIAL' | 'NONE' {
  if (analyses.length === 0) return 'NONE';
  if (analyses.every(a => a.status === 'COMPLETE')) return 'COMPLETE';
  if (analyses.some(a => a.status === 'PARTIAL' || a.status === 'COMPLETE')) return 'PARTIAL';
  return 'NONE';
}

function calculateConfidence(analyses: LineItemTechnicalAnalysis[]): number {
  if (analyses.length === 0) return 0;
  const sum = analyses.reduce((acc, curr) => acc + (curr.matchPercentage || 0), 0);
  return Math.round(sum / analyses.length);
}
