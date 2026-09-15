import type { SKU } from '../../../types';
import type { NormalizedTender } from '../normalization/types';
import { tokenize, tokensAgree } from './text';

export interface InventoryMatch {
  match: boolean;
  /** 0-100 strength of the best matching SKU. */
  confidence: number;
  matchedItems: { sku: SKU; score: number }[];
  quantityAvailable: number;
  inStock: boolean;
  missingRequirements: string[];
  procurementRequired: boolean;
}

/**
 * Answers: does this organisation carry anything relevant, and how well?
 *
 * Returns structure, not a boolean. Scores the BEST matching SKU rather than
 * the fraction of the catalogue that matched — the old formula divided by
 * inventory.length, so importing unrelated SKUs lowered every tender's score.
 */
export class InventoryMatcher {
  constructor(private inventory: SKU[]) {}

  match(tender: NormalizedTender): InventoryMatch {
    // Scores against parsed portal text only. An unreadable card scores zero
    // instead of matching on its display placeholder.
    const haystack = tender.matchableText.toLowerCase().trim();
    const bidTokens = tokenize(haystack);

    if (bidTokens.length === 0) {
      return {
        match: false,
        confidence: 0,
        matchedItems: [],
        quantityAvailable: 0,
        inStock: false,
        missingRequirements: ['tender text could not be parsed'],
        procurementRequired: true,
      };
    }

    const matchedItems: { sku: SKU; score: number }[] = [];

    for (const item of this.inventory) {
      const category = (item.productCategory || '').toLowerCase();
      const subCategory = (item.productSubCategory || '').toLowerCase();
      const name = (item.productName || '').toLowerCase();

      // A direct category/sub-category hit remains a strong signal.
      const directHit =
        (category && haystack.includes(category)) || (subCategory && haystack.includes(subCategory));

      const skuTokens = tokenize(`${category} ${subCategory} ${name}`);
      const overlap = bidTokens.filter(t => skuTokens.some(s => tokensAgree(t, s))).length;
      const overlapRatio = bidTokens.length > 0 ? overlap / bidTokens.length : 0;

      const score = Math.round(Math.max(directHit ? 70 : 0, overlapRatio * 100));
      if (score > 0) matchedItems.push({ sku: item, score: Math.min(100, score) });
    }

    // Ties break on SKU code so the same catalogue always yields the same
    // best match regardless of the order rows came back from the database.
    matchedItems.sort(
      (a, b) =>
        b.score - a.score ||
        b.sku.availableQuantity - a.sku.availableQuantity ||
        a.sku.skuId.localeCompare(b.sku.skuId)
    );

    const confidence = matchedItems[0]?.score ?? 0;
    const quantityAvailable = matchedItems.reduce((sum, m) => sum + (m.sku.availableQuantity || 0), 0);
    const inStock = matchedItems.some(m => m.sku.availableQuantity > 0);

    return {
      match: confidence > 0,
      confidence,
      matchedItems: matchedItems.slice(0, 5),
      quantityAvailable,
      inStock,
      missingRequirements: confidence === 0 ? ['no catalogue overlap'] : [],
      procurementRequired: !inStock,
    };
  }
}
