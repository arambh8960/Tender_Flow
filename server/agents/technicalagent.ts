import type { SKU, RfpProductLineItem } from '../../types';

/**
 * Technical agent — evidence-based specification matching.
 *
 * What changed and why:
 *
 *  - Nothing is marked `verified: true` any more unless a specific SKU
 *    attribute actually satisfies the requirement. The old version set that
 *    flag on every requirement whenever the overall spec score exceeded 50,
 *    which meant the UI showed "verified" for standards the product had
 *    never been checked against.
 *
 *  - The 30-point safety floor is gone. It made an unrelated product score
 *    30% instead of 0%, so a completely wrong SKU still cleared the
 *    15% qualification threshold.
 *
 *  - A mandatory specification that conflicts with the SKU now caps the
 *    result at MISMATCH regardless of how much other text overlaps, rather
 *    than being outvoted by generic keyword matches.
 *
 * Scoring is pure and deterministic: same line item plus same catalogue
 * yields the same numbers on every run. No randomness, no clock.
 */

export type ComplianceStatus = 'MATCHED' | 'PARTIAL' | 'MISMATCH' | 'NOT_FOUND' | 'REQUIRES_REVIEW';

export interface ComplianceCheck {
  requirement: string;
  detectedValue: string | null;
  /** Which SKU attribute supplied the evidence, when one did. */
  source: string | null;
  status: ComplianceStatus;
  evidence: string;
  /** 0-1. Reflects how direct the evidence is, not how much we hope. */
  confidence: number;
}

export interface ScoreComponents {
  categoryScore: number;
  nameScore: number;
  specificationScore: number;
  availabilityScore: number;
  total: number;
}

export interface Candidate {
  sku: SKU;
  matchPercentage: number;
  components: ScoreComponents;
  complianceChecks: ComplianceCheck[];
  stockStatus: 'FULL' | 'PARTIAL' | 'ZERO';
  blockingMismatches: string[];
}

/* Weights sum to 100 before the availability multiplier is applied. */
const WEIGHTS = { category: 35, name: 25, specification: 40 } as const;

const AVAILABILITY = { FULL: 1.0, PARTIAL: 0.85, ZERO: 0.5 } as const;

/** Threshold below which a candidate is not considered a match at all. */
const MATCH_THRESHOLD = 25;
const COMPLETE_THRESHOLD = 75;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'per', 'nos', 'set', 'sets', 'unit', 'units',
  'type', 'size', 'item', 'items', 'supply', 'make', 'any', 'all', 'other',
]);

export function tokenize(value: string): string[] {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
}

/**
 * Token overlap as a 0-1 ratio, measured against the requirement side.
 *
 * Deliberately NOT normalised by the shorter of the two strings: doing that
 * let a two-word SKU category score full marks against a long, specific
 * requirement it barely related to.
 */
export function tokenOverlap(required: string[], candidate: string[]): number {
  if (required.length === 0 || candidate.length === 0) return 0;

  const matched = required.filter(token =>
    candidate.some(other => other === token || (token.length > 4 && other.includes(token)) || (other.length > 4 && token.includes(other)))
  );

  return matched.length / required.length;
}

/** Pulls a numeric magnitude and its unit out of a specification string. */
function parseMeasurement(text: string): { value: number; unit: string } | null {
  const match = String(text).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|kg|g|w|kw|v|a|mpa|bar|litre|l|ltr|inch|hp|rpm|%)\b/);
  if (!match) return null;
  return { value: Number(match[1]), unit: match[2] };
}

/** Extracts Indian Standard references, e.g. "IS 2062", "IS:1239 Part 1". */
function extractStandards(text: string): string[] {
  const matches = String(text).toUpperCase().matchAll(/\bIS[\s:-]*(\d{2,5})\b/g);
  return [...matches].map(m => `IS ${m[1]}`);
}

/**
 * Evaluates one requirement against one SKU, returning what was actually
 * found rather than a verdict inferred from an aggregate score.
 */
export function evaluateRequirement(requirement: string, sku: SKU): ComplianceCheck {
  const specEntries = Object.entries(sku.specification ?? {});
  const requirementStandards = extractStandards(requirement);

  // 1. Standards are the strongest signal: an IS number either appears in the
  //    SKU's attributes or it does not.
  if (requirementStandards.length > 0) {
    for (const [key, rawValue] of specEntries) {
      const valueStandards = extractStandards(String(rawValue));
      const hit = requirementStandards.find(std => valueStandards.includes(std));
      if (hit) {
        return {
          requirement,
          detectedValue: String(rawValue),
          source: key,
          status: 'MATCHED',
          evidence: `${hit} declared in the SKU attribute "${key}".`,
          confidence: 0.95,
        };
      }
    }

    // A different standard of the same kind is a conflict, not an absence.
    const skuStandards = specEntries.flatMap(([, v]) => extractStandards(String(v)));
    if (skuStandards.length > 0) {
      return {
        requirement,
        detectedValue: skuStandards.join(', '),
        source: 'specification',
        status: 'MISMATCH',
        evidence: `Tender requires ${requirementStandards.join(', ')}; the SKU declares ${skuStandards.join(', ')}.`,
        confidence: 0.9,
      };
    }

    return {
      requirement,
      detectedValue: null,
      source: null,
      status: 'NOT_FOUND',
      evidence: `No ${requirementStandards.join(', ')} declaration is recorded against this SKU.`,
      confidence: 0.8,
    };
  }

  // 2. Numeric requirements: compare magnitude and unit.
  const requiredMeasurement = parseMeasurement(requirement);
  if (requiredMeasurement) {
    for (const [key, rawValue] of specEntries) {
      const candidate = parseMeasurement(String(rawValue));
      if (!candidate || candidate.unit !== requiredMeasurement.unit) continue;

      if (candidate.value === requiredMeasurement.value) {
        return {
          requirement,
          detectedValue: String(rawValue),
          source: key,
          status: 'MATCHED',
          evidence: `"${key}" is ${candidate.value}${candidate.unit}, exactly as required.`,
          confidence: 0.9,
        };
      }

      // Within 10% is a judgement call a person has to make, not one we can
      // assert on the company's behalf.
      const drift = Math.abs(candidate.value - requiredMeasurement.value) / requiredMeasurement.value;
      if (drift <= 0.1) {
        return {
          requirement,
          detectedValue: String(rawValue),
          source: key,
          status: 'REQUIRES_REVIEW',
          evidence: `"${key}" is ${candidate.value}${candidate.unit} against a required ${requiredMeasurement.value}${requiredMeasurement.unit} — within 10%, needs confirmation.`,
          confidence: 0.6,
        };
      }

      return {
        requirement,
        detectedValue: String(rawValue),
        source: key,
        status: 'MISMATCH',
        evidence: `"${key}" is ${candidate.value}${candidate.unit}, but ${requiredMeasurement.value}${requiredMeasurement.unit} is required.`,
        confidence: 0.9,
      };
    }

    return {
      requirement,
      detectedValue: null,
      source: null,
      status: 'NOT_FOUND',
      evidence: `No attribute expresses a value in ${requiredMeasurement.unit}.`,
      confidence: 0.7,
    };
  }

  // 3. Textual requirement: exact attribute-value containment only.
  const requirementTokens = tokenize(requirement);
  for (const [key, rawValue] of specEntries) {
    const valueTokens = tokenize(String(rawValue));
    const overlap = tokenOverlap(requirementTokens, valueTokens);

    if (overlap >= 0.8) {
      return {
        requirement,
        detectedValue: String(rawValue),
        source: key,
        status: 'MATCHED',
        evidence: `"${key}" = "${rawValue}" covers the requirement.`,
        confidence: 0.75,
      };
    }
    if (overlap >= 0.4) {
      return {
        requirement,
        detectedValue: String(rawValue),
        source: key,
        status: 'PARTIAL',
        evidence: `"${key}" = "${rawValue}" partially addresses the requirement.`,
        confidence: 0.5,
      };
    }
  }

  return {
    requirement,
    detectedValue: null,
    source: null,
    status: 'NOT_FOUND',
    evidence: 'No SKU attribute addresses this requirement.',
    confidence: 0.6,
  };
}

/** Deterministic score for one SKU against one line item. */
export function scoreCandidate(item: RfpProductLineItem, sku: SKU): Candidate {
  const itemTokens = tokenize(item.name);

  const categoryRatio = tokenOverlap(
    itemTokens,
    tokenize(`${sku.productCategory} ${sku.productSubCategory}`)
  );
  const nameRatio = tokenOverlap(itemTokens, tokenize(`${sku.productName} ${sku.oemBrand}`));

  const requirements = (item.technicalSpecs ?? []).filter(s => typeof s === 'string' && s.trim().length > 0);
  const complianceChecks = requirements.map(requirement => evaluateRequirement(requirement, sku));

  // Specification credit: full for MATCHED, half for PARTIAL, a quarter for
  // REQUIRES_REVIEW, nothing for NOT_FOUND or MISMATCH.
  const specificationRatio =
    complianceChecks.length === 0
      ? 0
      : complianceChecks.reduce((sum, check) => {
          if (check.status === 'MATCHED') return sum + 1;
          if (check.status === 'PARTIAL') return sum + 0.5;
          if (check.status === 'REQUIRES_REVIEW') return sum + 0.25;
          return sum;
        }, 0) / complianceChecks.length;

  // With no stated requirements there is no specification evidence either
  // way, so that share of the score is redistributed rather than awarded.
  const hasRequirements = complianceChecks.length > 0;
  const categoryScore = categoryRatio * (hasRequirements ? WEIGHTS.category : WEIGHTS.category + WEIGHTS.specification * 0.5);
  const nameScore = nameRatio * (hasRequirements ? WEIGHTS.name : WEIGHTS.name + WEIGHTS.specification * 0.5);
  const specificationScore = hasRequirements ? specificationRatio * WEIGHTS.specification : 0;

  const stockStatus: Candidate['stockStatus'] =
    sku.availableQuantity >= item.quantity ? 'FULL' : sku.availableQuantity > 0 ? 'PARTIAL' : 'ZERO';
  const availabilityWeight = AVAILABILITY[stockStatus];

  const rawTotal = categoryScore + nameScore + specificationScore;
  const total = Math.round(rawTotal * availabilityWeight);

  const blockingMismatches = complianceChecks
    .filter(check => check.status === 'MISMATCH')
    .map(check => check.requirement);

  return {
    sku,
    // A hard specification conflict caps the score below the match
    // threshold: no amount of name similarity redeems the wrong standard.
    matchPercentage: blockingMismatches.length > 0 ? Math.min(total, MATCH_THRESHOLD - 1) : Math.min(100, total),
    components: {
      categoryScore: Math.round(categoryScore),
      nameScore: Math.round(nameScore),
      specificationScore: Math.round(specificationScore),
      availabilityScore: Math.round(availabilityWeight * 100),
      total,
    },
    complianceChecks,
    stockStatus,
    blockingMismatches,
  };
}

export function runTechnicalAgent(
  rfpItems: RfpProductLineItem[],
  skus: SKU[]
): { itemAnalyses: any[]; riskEntries: any[] } {
  const riskEntries: any[] = [];
  const activeSkus = skus.filter(sku => sku.isActive !== false);

  const itemAnalyses = rfpItems.map((item, index) => {
    const line = index + 1;

    const scored = activeSkus
      .map(sku => scoreCandidate(item, sku))
      // Ties are broken deterministically so repeated runs rank identically.
      .sort(
        (a, b) =>
          b.matchPercentage - a.matchPercentage ||
          b.components.specificationScore - a.components.specificationScore ||
          b.sku.availableQuantity - a.sku.availableQuantity ||
          a.sku.skuId.localeCompare(b.sku.skuId)
      );

    const best = scored[0];

    if (!best || best.matchPercentage < MATCH_THRESHOLD) {
      riskEntries.push({
        category: 'Technical',
        riskLevel: 'High',
        statement: `Line ${line} ("${item.name}"): no SKU in the catalogue meets the requirement${
          best?.blockingMismatches.length ? ` — closest candidate ${best.sku.skuId} conflicts on ${best.blockingMismatches.join(', ')}` : ''
        }.`,
      });

      return {
        rfpLineItem: item,
        status: 'NONE' as const,
        selectedSku: null,
        matchPercentage: best?.matchPercentage ?? 0,
        technicalReasoning: best
          ? `Best available candidate ${best.sku.skuId} scored ${best.matchPercentage}%, below the ${MATCH_THRESHOLD}% match threshold.`
          : 'The organisation has no active inventory to match against.',
        complianceChecks: best?.complianceChecks ?? [],
        scoreComponents: best?.components ?? null,
        top3Recommendations: scored.slice(0, 3).map(toRecommendation),
      };
    }

    const status: 'COMPLETE' | 'PARTIAL' =
      best.matchPercentage >= COMPLETE_THRESHOLD && best.stockStatus === 'FULL' ? 'COMPLETE' : 'PARTIAL';

    if (best.stockStatus !== 'FULL') {
      riskEntries.push({
        category: 'Logistics',
        riskLevel: best.stockStatus === 'ZERO' ? 'High' : 'Medium',
        statement: `Line ${line}: inventory shortfall for ${best.sku.skuId} (${best.sku.availableQuantity}/${item.quantity}).`,
      });
    }

    const unresolved = best.complianceChecks.filter(
      c => c.status === 'NOT_FOUND' || c.status === 'REQUIRES_REVIEW'
    );
    if (unresolved.length > 0) {
      riskEntries.push({
        category: 'Technical',
        riskLevel: 'Medium',
        statement: `Line ${line}: ${unresolved.length} requirement(s) could not be verified against ${best.sku.skuId} — ${unresolved
          .slice(0, 3)
          .map(c => c.requirement)
          .join('; ')}.`,
      });
    }

    return {
      rfpLineItem: item,
      status,
      selectedSku: best.sku,
      matchPercentage: best.matchPercentage,
      technicalReasoning:
        `${best.sku.skuId} scored ${best.matchPercentage}% ` +
        `(category ${best.components.categoryScore}, name ${best.components.nameScore}, specifications ${best.components.specificationScore}). ` +
        `${best.complianceChecks.filter(c => c.status === 'MATCHED').length}/${best.complianceChecks.length} requirement(s) verified against recorded attributes.`,
      complianceChecks: best.complianceChecks,
      scoreComponents: best.components,
      top3Recommendations: scored.slice(0, 3).map(toRecommendation),
    };
  });

  return { itemAnalyses, riskEntries };
}

/** Keeps the SKU shape the UI already renders, plus the evidence. */
function toRecommendation(candidate: Candidate) {
  return {
    ...candidate.sku,
    matchPercentage: candidate.matchPercentage,
    scoreComponents: candidate.components,
    stockStatus: candidate.stockStatus,
    blockingMismatches: candidate.blockingMismatches,
  };
}
