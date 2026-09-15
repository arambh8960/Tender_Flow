import type { ProcurementPortalAdapter } from '../PortalAdapter';
import type { DiscoveryCriteria, NormalizedTender, RawTender } from '../../normalization/types';
import { GeMClient } from './GeMClient';
import { GeMParser } from './GeMParser';
import { GeMNormalizer } from './GeMNormalizer';
import type { GeMAdvancedParams } from './GeMTypes';

/**
 * Composes GeMClient (session), GeMParser (extraction) and GeMNormalizer
 * (translation) behind the portal-neutral interface.
 */
export class GeMAdapter implements ProcurementPortalAdapter {
  readonly portal = 'gem';
  readonly displayName = 'Government e-Marketplace';
  readonly supportsAdvancedSearch = true;

  private client = new GeMClient();
  private parser = new GeMParser();

  async search(criteria: DiscoveryCriteria): Promise<RawTender[]> {
    const collected: RawTender[] = [];

    if (criteria.advanced) {
      const html = await this.client.searchAdvanced(criteria.advanced as unknown as GeMAdvancedParams);
      for (const card of this.parser.parseSearchResults(html)) {
        collected.push(GeMNormalizer.toRawTender(card));
      }
      return collected;
    }

    for (const category of criteria.categories) {
      const html = await this.client.searchByCategory(category);
      for (const card of this.parser.parseSearchResults(html)) {
        collected.push(GeMNormalizer.toRawTender(card));
      }
    }

    return collected;
  }

  normalize(raw: RawTender): NormalizedTender {
    return GeMNormalizer.normalize(raw);
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }
}
