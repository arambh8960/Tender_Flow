import type { NormalizedTender, RawTender } from '../../normalization/types';
import type { GeMRawCard } from './GeMTypes';
import { GeMParser } from './GeMParser';

/**
 * GeM card -> the portal-neutral tender model.
 *
 * This is the boundary. Past this point nothing knows GeM exists.
 */
export class GeMNormalizer {
  static toRawTender(card: GeMRawCard): RawTender {
    return {
      externalId: card.bidNumber,
      parseWarnings: card.parseWarnings,
      source: { ...card },
    };
  }

  static normalize(raw: RawTender): NormalizedTender {
    const card = raw.source as unknown as GeMRawCard;

    const closing = GeMParser.parseGemDate(card.endDateText);
    if (card.endDateText && !closing && !raw.parseWarnings.includes('end_date_malformed')) {
      raw.parseWarnings.push('end_date_malformed');
    }

    // `matchableText` is what qualification scores against, and it is empty
    // when the portal text was unreadable. `title` may fall back to a
    // human-facing placeholder; the two must never be conflated.
    const matchableText = card.itemsText.trim();

    return {
      externalId: card.bidNumber || `gem-unknown-${hash(JSON.stringify(card))}`,
      portal: 'gem',

      title: matchableText || 'Untitled tender (portal text unreadable)',
      matchableText,
      buyer: card.orgName || undefined,
      category: matchableText || undefined,
      location: card.consigneeLocation || undefined,

      closingAt: closing ? closing.toISOString() : null,
      publishedAt: null,

      emdRequired: /^(yes|true)$/i.test(card.emdText),
      emdAmount: null,
      estimatedValue: null,

      tenderUrl: card.detailUrl || undefined,
      parseWarnings: raw.parseWarnings,
      sourceMetadata: { ...card },
    };
  }
}

/** Stable short hash so an unidentifiable card still dedupes against itself. */
function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
