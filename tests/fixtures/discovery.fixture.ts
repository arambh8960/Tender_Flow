import type { NormalizedTender } from '../../server/discovery/normalization/types';
import type { QualifierSettings } from '../../server/discovery/qualification/TenderQualifier';

/** Normalised tenders for qualification and scoring tests. */

const DAY_MS = 86_400_000;

/** A date N days from now, so tests never depend on a hardcoded calendar. */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

export function makeTender(overrides: Partial<NormalizedTender> = {}): NormalizedTender {
  return {
    externalId: 'GEM/2026/B/000001',
    portal: 'gem',
    title: 'Supply of XLPE Armoured Power Cable',
    matchableText: 'supply of xlpe armoured power cable 1100v cables power cable',
    buyer: 'Public Works Department',
    category: 'Cables',
    location: 'Ludhiana, Punjab',
    closingAt: daysFromNow(21),
    emdRequired: false,
    tenderUrl: 'https://bidplus.gem.gov.in/showbidDocument/000001',
    parseWarnings: [],
    sourceMetadata: {},
    ...overrides,
  };
}

/** Matches company A's cable SKU, deliverable, open, no EMD. */
export const QUALIFYING_TENDER = makeTender();

/** Nothing in company A's catalogue relates to this. */
export const UNRELATED_TENDER = makeTender({
  externalId: 'GEM/2026/B/000002',
  title: 'Supply of Hospital Bed Linen',
  matchableText: 'supply of hospital bed linen cotton bedsheets',
  category: 'Textiles',
});

/** Closing date already passed. */
export const EXPIRED_TENDER = makeTender({
  externalId: 'GEM/2026/B/000003',
  closingAt: daysFromNow(-5),
});

/** Closes today: technically open, but the lead time will not fit. */
export const SAME_DAY_TENDER = makeTender({
  externalId: 'GEM/2026/B/000004',
  closingAt: daysFromNow(0),
});

/** Portal gave a date string that cannot be parsed. */
export const MALFORMED_DATE_TENDER = makeTender({
  externalId: 'GEM/2026/B/000005',
  closingAt: null,
  parseWarnings: ['closing date could not be parsed'],
});

/** Requires an EMD deposit. */
export const EMD_TENDER = makeTender({
  externalId: 'GEM/2026/B/000006',
  emdRequired: true,
  emdAmount: 50_000,
});

/** Consignee far from every warehouse in the fixture catalogue. */
export const DISTANT_TENDER = makeTender({
  externalId: 'GEM/2026/B/000007',
  location: 'Thiruvananthapuram, Kerala',
});

/** The card could not be parsed: no matchable text at all. */
export const UNPARSEABLE_TENDER = makeTender({
  externalId: 'GEM/2026/B/000008',
  title: '',
  matchableText: '',
  category: undefined,
  buyer: undefined,
  location: undefined,
  parseWarnings: ['title could not be extracted', 'buyer could not be extracted'],
});

/** Consignee text that no gazetteer entry covers. */
export const UNRESOLVABLE_LOCATION_TENDER = makeTender({
  externalId: 'GEM/2026/B/000009',
  location: 'Block C, Sector 9 Extension',
});

export function makeSettings(overrides: Partial<QualifierSettings> = {}): QualifierSettings {
  return {
    assumedAvgKms: 400,
    ratePerKm: 55,
    allowEmd: true,
    minMatchThreshold: 20,
    validCertificates: [],
    ...overrides,
  } as QualifierSettings;
}
