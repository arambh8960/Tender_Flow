import type { NormalizedTender } from '../normalization/types';

export interface ComplianceAssessment {
  score: number;
  missing: string[];
}

export interface ComplianceContext {
  /** Certificate names the organisation holds and that are currently valid. */
  validCertificates: string[];
}

/**
 * Compliance readiness.
 *
 * Search-result cards rarely state certificate requirements, so this stage is
 * intentionally shallow at discovery time and deepens during full analysis,
 * where the ATC text is available.
 */
export class ComplianceQualifier {
  constructor(private context: ComplianceContext) {}

  assess(tender: NormalizedTender): ComplianceAssessment {
    const text = tender.matchableText.toLowerCase();
    const commonStandards = ['iso 9001', 'iso 14001', 'iso 45001', 'bis', 'isi', 'iec', 'ce'];

    // Word-boundary matching: a bare substring test reported "ce" as a
    // demanded standard whenever the text contained "certified", which
    // manufactured a missing-certificate finding out of ordinary prose.
    const demanded = commonStandards.filter(standard => {
      const pattern = new RegExp(`(^|[^a-z0-9])${standard.replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`, 'i');
      return pattern.test(text);
    });
    if (demanded.length === 0) {
      // Nothing detectable to check against; neutral rather than a free pass.
      return { score: this.context.validCertificates.length > 0 ? 70 : 50, missing: [] };
    }

    const held = this.context.validCertificates.map(c => c.toLowerCase());
    const missing = demanded.filter(d => !held.some(h => h.includes(d)));
    const score = Math.round(((demanded.length - missing.length) / demanded.length) * 100);

    return { score, missing };
  }
}
