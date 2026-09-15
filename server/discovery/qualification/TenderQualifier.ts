import type { SKU } from '../../../types';
import type { NormalizedTender } from '../normalization/types';
import { InventoryMatcher, type InventoryMatch } from './InventoryMatcher';
import { TechnicalQualifier, type TechnicalAssessment } from './TechnicalQualifier';
import { LogisticsQualifier, type LogisticsAssessment, type LogisticsSettings } from './LogisticsQualifier';
import { CommercialQualifier, type CommercialAssessment, type CommercialSettings } from './CommercialQualifier';
import { ComplianceQualifier, type ComplianceAssessment, type ComplianceContext } from './ComplianceQualifier';

export interface QualificationScores {
  inventory_score: number;
  technical_score: number;
  quantity_score: number;
  compliance_score: number;
  logistics_score: number;
  commercial_score: number;
  overall_score: number;
}

export interface QualificationResult {
  tender: NormalizedTender;
  scores: QualificationScores;
  isQualified: boolean;
  reason: string;
  breakdown: {
    inventory: InventoryMatch;
    technical: TechnicalAssessment;
    logistics: LogisticsAssessment;
    commercial: CommercialAssessment;
    compliance: ComplianceAssessment;
  };
}

export interface QualifierSettings extends LogisticsSettings, CommercialSettings, ComplianceContext {
  minMatchThreshold: number;
  /** Skip gating entirely (used by background auto-discovery). */
  bypassFilters?: boolean;
}

/**
 * Composes the independent scorers into one opportunity score.
 *
 * Weights are declared in one place so a component can be reweighted or
 * swapped without touching the others. Each score remains individually
 * inspectable and is persisted separately.
 */
const WEIGHTS = {
  inventory: 0.30,
  technical: 0.25,
  quantity: 0.10,
  logistics: 0.10,
  commercial: 0.15,
  compliance: 0.10,
};

export class TenderQualifier {
  private lastLogistics: LogisticsAssessment | null = null;
  private inventoryMatcher: InventoryMatcher;
  private technical = new TechnicalQualifier();
  private logistics: LogisticsQualifier;
  private commercial: CommercialQualifier;
  private compliance: ComplianceQualifier;

  constructor(inventory: SKU[], private settings: QualifierSettings) {
    this.inventoryMatcher = new InventoryMatcher(inventory);
    this.logistics = new LogisticsQualifier(settings);
    this.commercial = new CommercialQualifier(settings);
    this.compliance = new ComplianceQualifier(settings);
  }

  qualify(tender: NormalizedTender): QualificationResult {
    const inventory = this.inventoryMatcher.match(tender);
    const bestSku = inventory.matchedItems[0]?.sku ?? null;

    const technical = this.technical.assess(tender, inventory);
    // Every matched SKU is passed, not just the best one: the nearest
    // warehouse holding relevant stock may not belong to the top match.
    const logistics = this.logistics.assess(
      tender,
      bestSku,
      inventory.matchedItems.map(item => item.sku)
    );
    const commercial = this.commercial.assess(tender);
    const compliance = this.compliance.assess(tender);

    const overall = Math.round(
      inventory.confidence * WEIGHTS.inventory +
        technical.score * WEIGHTS.technical +
        technical.quantityScore * WEIGHTS.quantity +
        logistics.score * WEIGHTS.logistics +
        commercial.score * WEIGHTS.commercial +
        compliance.score * WEIGHTS.compliance
    );

    const scores: QualificationScores = {
      inventory_score: inventory.confidence,
      technical_score: technical.score,
      quantity_score: technical.quantityScore,
      compliance_score: compliance.score,
      logistics_score: logistics.score,
      commercial_score: commercial.score,
      overall_score: overall,
    };

    // decide() reads the logistics outcome; keeping it on the instance avoids
    // widening the signature for one field.
    this.lastLogistics = logistics;
    const { isQualified, reason } = this.decide(inventory, commercial, scores);

    return { tender, scores, isQualified, reason, breakdown: { inventory, technical, logistics, commercial, compliance } };
  }

  private decide(
    inventory: InventoryMatch,
    commercial: CommercialAssessment,
    scores: QualificationScores
  ): { isQualified: boolean; reason: string } {
    if (this.settings.bypassFilters) {
      return { isQualified: true, reason: 'Filters bypassed (background scan).' };
    }

    if (!inventory.match) {
      return { isQualified: false, reason: 'No product in this organisation\'s catalogue matches the tender.' };
    }

    if (commercial.emdBlocked) {
      return { isQualified: false, reason: 'Tender requires an EMD deposit, which is excluded by settings.' };
    }

    if (!this.lastLogistics?.feasible) {
      return {
        isQualified: false,
        reason:
          this.lastLogistics?.notes.find(note => note.includes('beyond') || note.includes('exceeds')) ??
          'Delivery is not feasible for this tender.',
      };
    }

    if (inventory.confidence < this.settings.minMatchThreshold) {
      return {
        isQualified: false,
        reason: `Inventory match ${inventory.confidence}% is below the ${this.settings.minMatchThreshold}% threshold.`,
      };
    }

    const reasons: string[] = [];
    if (inventory.confidence >= 80) reasons.push('high inventory overlap');
    if (inventory.inStock) reasons.push('stock available now');
    if (!commercial.emdBlocked && commercial.score >= 70) reasons.push('favourable commercial terms');

    return {
      isQualified: true,
      reason: reasons.length ? `Qualified: ${reasons.join(', ')}.` : `Qualified with an overall score of ${scores.overall_score}.`,
    };
  }
}
