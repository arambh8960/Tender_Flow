import type { NormalizedTender } from '../normalization/types';

export interface DedupResult {
  unique: NormalizedTender[];
  duplicates: number;
}

/**
 * Identity is (portal, externalId).
 *
 * The same tender surfacing from a search for "XLPE Cable" and another for
 * "Electrical Cable" is one tender, not two. The database enforces the same
 * rule with a unique constraint on (organization_id, portal, external_id);
 * this pass avoids the pointless round-trips.
 */
export class Deduplicator {
  static withinRun(tenders: NormalizedTender[]): DedupResult {
    const seen = new Map<string, NormalizedTender>();
    let duplicates = 0;

    for (const t of tenders) {
      const key = `${t.portal}::${t.externalId}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, t);
        continue;
      }
      duplicates++;
      // Keep whichever copy parsed more cleanly.
      if (t.parseWarnings.length < existing.parseWarnings.length) seen.set(key, t);
    }

    return { unique: [...seen.values()], duplicates };
  }
}
