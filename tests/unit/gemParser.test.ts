import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { GeMParser } from '../../server/discovery/portals/gem/GeMParser';
import { GeMNormalizer } from '../../server/discovery/portals/gem/GeMNormalizer';

/**
 * Parser and normaliser tests.
 *
 * The parser is browser-free by design, so it runs against saved HTML without
 * launching Puppeteer. The behaviour being locked in is that an unreadable
 * field comes back EMPTY and warned about — never substituted with an
 * invented value, because a fabricated organisation or category is
 * indistinguishable from a scraped one once it is downstream.
 */

const parser = new GeMParser();
const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/gem-pages', name), 'utf8');

describe('GeMParser — well-formed result pages', () => {
  it('extracts every field from a standard card', () => {
    const [card] = parser.parseSearchResults(fixture('results-page.html'));

    expect(card.bidNumber).toBe('GEM/2026/B/123456');
    expect(card.itemsText).toBe('XLPE Armoured Power Cable 1100V');
    expect(card.orgName).toBe('Central Public Works Department');
    expect(card.endDateText).toBe('30-11-2026');
    expect(card.consigneeLocation).toBe('Ludhiana, Punjab');
    expect(card.emdText).toBe('Yes');
    expect(card.detailUrl).toBe('https://bidplus.gem.gov.in/showbidDocument/998877');
    expect(card.parseWarnings).toEqual([]);
  });

  it('parses every card on a multi-result page', () => {
    const cards = parser.parseSearchResults(fixture('results-page.html'));
    expect(cards).toHaveLength(3);
    expect(cards.map(c => c.bidNumber)).toEqual([
      'GEM/2026/B/123456',
      'GEM/2026/B/123457',
      'GEM/2026/B/123458',
    ]);
  });

  it('returns nothing for an empty results page', () => {
    expect(parser.parseSearchResults(fixture('empty-results-page.html'))).toEqual([]);
    expect(parser.parseSearchResults('')).toEqual([]);
    expect(parser.parseSearchResults('   ')).toEqual([]);
  });
});

describe('GeMParser — missing fields are reported, never invented', () => {
  it('leaves a missing organisation empty rather than defaulting to a ministry', () => {
    const [card] = parser.parseSearchResults(fixture('missing-fields.html'));

    expect(card.orgName).toBe('');
    expect(card.parseWarnings).toContain('org_name');
    expect(card.orgName).not.toBe('Ministry of Defence');
  });

  it('leaves missing item text empty rather than defaulting to a category', () => {
    const cards = parser.parseSearchResults(fixture('missing-fields.html'));
    const noItems = cards.find(c => c.bidNumber === 'GEM/2026/B/NOITEMS');

    expect(noItems?.itemsText).toBe('');
    expect(noItems?.parseWarnings).toContain('items');
    expect(noItems?.itemsText).not.toBe('Industrial Supply');
  });

  it('warns about a missing end date', () => {
    const cards = parser.parseSearchResults(fixture('missing-fields.html'));
    const noDate = cards.find(c => c.bidNumber === 'GEM/2026/B/NODATE');

    expect(noDate?.endDateText).toBe('');
    expect(noDate?.parseWarnings).toContain('end_date');
  });

  it('warns about every field on a completely empty card', () => {
    const [card] = parser.parseSearchResults('<div class="card"></div>');
    for (const field of ['bid_number', 'items', 'org_name', 'consignee_location', 'end_date', 'detail_url']) {
      expect(card.parseWarnings).toContain(field);
    }
  });

  it('produces no detail URL when the href carries no id', () => {
    const html = '<div class="card"><a class="bid_no_hover" href="/no-digits-here">B1</a></div>';
    const [card] = parser.parseSearchResults(html);

    expect(card.detailUrl).toBe('');
    expect(card.parseWarnings).toContain('detail_url');
  });

  it('survives unexpected markup without throwing', () => {
    expect(() => parser.parseSearchResults(fixture('unexpected-markup.html'))).not.toThrow();
    const cards = parser.parseSearchResults(fixture('unexpected-markup.html'));
    // Whatever it manages to read, it must never claim a clean parse.
    for (const card of cards) expect(card.parseWarnings.length).toBeGreaterThan(0);
  });
});

describe('GeMParser.parseGemDate', () => {
  it('parses the DD-MM-YYYY the portal renders', () => {
    const parsed = GeMParser.parseGemDate('30-11-2026');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(10);
    expect(parsed?.getDate()).toBe(30);
  });

  it('returns null for malformed input rather than guessing', () => {
    for (const bad of ['', '2026-11-30', '30/11/2026', 'tomorrow', '1-1-26', 'not a date']) {
      expect(GeMParser.parseGemDate(bad)).toBeNull();
    }
  });

  it('rejects impossible dates instead of rolling them over', () => {
    // Date() would silently turn 31-02 into 3 March.
    expect(GeMParser.parseGemDate('31-02-2026')).toBeNull();
    expect(GeMParser.parseGemDate('32-01-2026')).toBeNull();
    expect(GeMParser.parseGemDate('01-13-2026')).toBeNull();
  });
});

describe('GeMNormalizer', () => {
  it('keeps matchableText empty when the portal text was unreadable', () => {
    const cards = parser.parseSearchResults(fixture('missing-fields.html'));
    const noItems = cards.find(c => c.bidNumber === 'GEM/2026/B/NOITEMS');
    const normalized = GeMNormalizer.normalize(GeMNormalizer.toRawTender(noItems!));

    // The title may carry a human-facing placeholder; the text that
    // qualification scores against must not.
    expect(normalized.matchableText).toBe('');
    expect(normalized.title).toMatch(/unreadable/i);
    expect(normalized.category).toBeUndefined();
  });

  it('records a malformed date as a warning and a null closing date', () => {
    const html =
      '<div class="card"><a class="bid_no_hover" href="/x/1">B1</a><p>Items: Cable</p>' +
      '<span class="end_date">31-02-2026</span></div>';
    const [card] = parser.parseSearchResults(html);
    const normalized = GeMNormalizer.normalize(GeMNormalizer.toRawTender(card));

    expect(normalized.closingAt).toBeNull();
    expect(normalized.parseWarnings).toContain('end_date_malformed');
  });

  it('reads the EMD flag without inferring one', () => {
    const withEmd = parser.parseSearchResults(fixture('results-page.html'))[0];
    expect(GeMNormalizer.normalize(GeMNormalizer.toRawTender(withEmd)).emdRequired).toBe(true);

    const [noEmdCard] = parser.parseSearchResults('<div class="card"><p>Items: Cable EMD: No</p></div>');
    expect(GeMNormalizer.normalize(GeMNormalizer.toRawTender(noEmdCard)).emdRequired).toBe(false);
  });

  it('is deterministic: the same HTML always yields the same normalised output', () => {
    const html = fixture('results-page.html');
    const first = parser.parseSearchResults(html).map(c => GeMNormalizer.normalize(GeMNormalizer.toRawTender(c)));
    const second = parser.parseSearchResults(html).map(c => GeMNormalizer.normalize(GeMNormalizer.toRawTender(c)));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('GeMParser — changed class names', () => {
  it('still reads the bid number when only the card wrapper class survives', () => {
    // Portals reskin; the card selector is the one anchor we rely on, and a
    // partial read must degrade into warnings rather than an exception.
    const html =
      '<div class="card"><a class="bid_no_hover" href="/showbidDocument/555">GEM/2026/B/999</a>' +
      '<div class="renamed_org">Some Buyer</div><p>Items: Copper Cable</p></div>';
    const [card] = parser.parseSearchResults(html);

    expect(card.bidNumber).toBe('GEM/2026/B/999');
    expect(card.itemsText).toBe('Copper Cable');
    expect(card.orgName).toBe('');
    expect(card.parseWarnings).toContain('org_name');
  });
});
