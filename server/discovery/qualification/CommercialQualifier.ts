import type { NormalizedTender } from '../normalization/types';

export interface CommercialAssessment {
  score: number;
  emdBlocked: boolean;
  notes: string[];
}

export interface CommercialSettings {
  allowEmd: boolean;
}

/** Business attractiveness and commercial blockers. */
export class CommercialQualifier {
  constructor(private settings: CommercialSettings) {}

  assess(tender: NormalizedTender): CommercialAssessment {
    const notes: string[] = [];
    let score = 60;

    const emdBlocked = Boolean(tender.emdRequired) && !this.settings.allowEmd;
    if (emdBlocked) {
      notes.push('Tender requires an EMD deposit, which this organisation has excluded.');
      score -= 40;
    } else if (!tender.emdRequired) {
      notes.push('No EMD deposit required.');
      score += 20;
    }

    if (tender.closingAt) {
      const daysLeft = Math.round((new Date(tender.closingAt).getTime() - Date.now()) / 86400000);
      if (daysLeft < 3) {
        notes.push(`Closes in ${daysLeft} day(s) — little time to prepare.`);
        score -= 20;
      } else if (daysLeft > 14) {
        score += 10;
      }
    }

    return { score: Math.max(0, Math.min(100, score)), emdBlocked, notes };
  }
}
