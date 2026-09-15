import type { NormalizedTender } from '../normalization/types';
import type { InventoryMatch } from './InventoryMatcher';

export interface TechnicalAssessment {
  score: number;
  quantityScore: number;
  gaps: string[];
}

/**
 * Specification and quantity compatibility, kept independent of the
 * keyword/inventory relevance stage so the two can evolve separately.
 */
export class TechnicalQualifier {
  assess(tender: NormalizedTender, inventory: InventoryMatch): TechnicalAssessment {
    const gaps: string[] = [];

    if (!inventory.match) {
      return { score: 0, quantityScore: 0, gaps: ['no matching product'] };
    }

    const best = inventory.matchedItems[0];
    let score = best.score;

    // Specification agreement, where the portal gave us anything to compare.
    const specValues = Object.values(best.sku.specification ?? {}).map(v => String(v).toLowerCase());
    const text = tender.matchableText.toLowerCase();
    const specHits = specValues.filter(v => v.length > 2 && text.includes(v)).length;

    if (specValues.length > 0) {
      const specRatio = specHits / specValues.length;
      score = Math.round(score * 0.7 + specRatio * 100 * 0.3);
      if (specHits === 0) gaps.push('no specification values matched the tender text');
    }

    if (tender.parseWarnings.length > 0) {
      gaps.push(`portal fields unread: ${tender.parseWarnings.join(', ')}`);
    }

    // Quantity is rarely on the search card; absence is unknown, not zero.
    const quantityScore = inventory.inStock ? 100 : 0;
    if (!inventory.inStock) gaps.push('matched product is out of stock');

    return { score: Math.max(0, Math.min(100, score)), quantityScore, gaps };
  }
}
