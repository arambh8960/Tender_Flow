/**
 * The portal-neutral tender vocabulary.
 *
 * Nothing downstream of a PortalAdapter may see portal-specific shapes.
 * Previously GeMBid (with its `org`, `endDate`, `consigneeLocation` fields)
 * was spread straight into the app-wide Tender type, which is what made
 * adding a second portal impossible without touching every consumer.
 */

/** What a portal client returns before any interpretation. */
export interface RawTender {
  /** Portal's own identifier, as scraped. */
  externalId: string;
  /** Fields the parser could not read on this record. */
  parseWarnings: string[];
  /** Everything the portal gave us, kept for audit and re-parsing. */
  source: Record<string, unknown>;
}

export interface NormalizedTender {
  externalId: string;
  portal: string;

  title: string;
  /** Portal text actually parsed — empty when unreadable. Never a placeholder. */
  matchableText: string;
  description?: string;
  buyer?: string;
  category?: string;
  subcategory?: string;
  location?: string;
  latitude?: number;
  longitude?: number;

  publishedAt?: string | null;
  closingAt?: string | null;

  estimatedValue?: number | null;
  emdAmount?: number | null;
  emdRequired?: boolean;

  tenderUrl?: string;
  parseWarnings: string[];
  sourceMetadata: Record<string, unknown>;
}

export interface DiscoveryCriteria {
  /** Free-text categories for keyword search. */
  categories: string[];
  /** Portal-specific advanced parameters, opaque to the coordinator. */
  advanced?: Record<string, unknown>;
  /** Only keep tenders closing within this many days. */
  closingWithinDays?: number;
}
