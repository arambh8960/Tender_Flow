import type { DiscoveryCriteria, NormalizedTender, RawTender } from '../normalization/types';

/**
 * Contract every procurement portal implements.
 *
 * The DiscoveryCoordinator talks only to this interface. It has no knowledge
 * of DOM selectors, HTML structure, or any portal's response format — adding
 * CPPP or another portal means adding an implementation, not editing the
 * engine.
 */
export interface ProcurementPortalAdapter {
  /** Stable key: 'gem', 'cppp', … */
  readonly portal: string;
  readonly displayName: string;

  /** Whether this adapter can run an advanced (form-driven) search. */
  readonly supportsAdvancedSearch: boolean;

  search(criteria: DiscoveryCriteria): Promise<RawTender[]>;

  /** Optional deep fetch of a single tender's detail page. */
  fetchTenderDetails?(externalId: string): Promise<RawTender | null>;

  normalize(raw: RawTender): NormalizedTender;

  /** Release any browser/session resources. */
  dispose?(): Promise<void>;
}

/** Raised when a portal genuinely failed, as opposed to returning no results. */
export class PortalError extends Error {
  constructor(
    public portal: string,
    public scope: string,
    message: string,
    public kind: 'network' | 'timeout' | 'blocked' | 'parser' | 'unknown' = 'unknown'
  ) {
    super(message);
    this.name = 'PortalError';
  }
}
