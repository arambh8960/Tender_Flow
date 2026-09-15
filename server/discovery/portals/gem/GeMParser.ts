import * as cheerio from 'cheerio';
import { GEM_SELECTORS, GEM_URLS } from './GeMSelectors';
import type { GeMRawCard } from './GeMTypes';

/**
 * Turns GeM results HTML into structured cards.
 *
 * Deliberately pure and browser-free: it takes a string and returns data, so
 * it can be tested against saved fixtures without launching Puppeteer.
 *
 * It never invents values. A field it cannot read is returned empty and
 * recorded in parseWarnings. The previous implementation substituted
 * "Industrial Supply" and "Ministry of Defence" for missing text, which made
 * fabricated data indistinguishable from scraped data downstream — and, worse,
 * let a placeholder score a 100% inventory match.
 */
export class GeMParser {
  parseSearchResults(html: string): GeMRawCard[] {
    if (!html || !html.trim()) return [];

    const $ = cheerio.load(html);
    const cards: GeMRawCard[] = [];

    $(GEM_SELECTORS.card).each((_i, el) => {
      cards.push(this.parseCard($, el));
    });

    return cards;
  }

  private parseCard($: cheerio.CheerioAPI, el: any): GeMRawCard {
    const $card = $(el);
    const text = $card.text().replace(/\s+/g, ' ').trim();

    const $link = $card.find(GEM_SELECTORS.cardLink).first();
    const bidNumber = $link.text().trim();
    const href = $link.attr('href') ?? '';
    const idMatch = href.match(/\d+/);
    const detailUrl = idMatch ? GEM_URLS.bidDocument(idMatch[0]) : '';

    const endDateText = ($card.find(GEM_SELECTORS.endDate).first().text().match(/\d{2}-\d{2}-\d{4}/) ?? [''])[0];
    const orgName = $card.find(GEM_SELECTORS.orgName).first().text().trim();
    const consigneeLocation = $card.find(GEM_SELECTORS.consigneeLocation).first().text().trim();

    const itemsMatch = text.match(/Items:\s*(.*?)(?:\s+(?:Quantity|Department|Start Date|End Date|EMD)\b|$)/i);
    const itemsText = itemsMatch ? itemsMatch[1].trim() : '';

    const emdMatch = text.match(/EMD[^:]*:\s*([^\s]+)/i);
    const emdText = emdMatch ? emdMatch[1].trim() : '';

    const parseWarnings: string[] = [];
    if (!bidNumber) parseWarnings.push('bid_number');
    if (!itemsText) parseWarnings.push('items');
    if (!orgName) parseWarnings.push('org_name');
    if (!consigneeLocation) parseWarnings.push('consignee_location');
    if (!endDateText) parseWarnings.push('end_date');
    if (!detailUrl) parseWarnings.push('detail_url');

    return {
      bidNumber,
      itemsText,
      orgName,
      endDateText,
      consigneeLocation,
      detailUrl,
      emdText,
      parseWarnings,
    };
  }

  /** GeM renders DD-MM-YYYY. Returns null for anything unparseable. */
  static parseGemDate(value: string): Date | null {
    if (!value) return null;
    const m = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return null;

    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const d = new Date(year, month - 1, day);
    // Rejects impossible dates like 31-02-2026, which Date would roll over.
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }
}
