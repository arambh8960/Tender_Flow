import puppeteer, { Browser, Page } from 'puppeteer';
import { GEM_SELECTORS, GEM_TIMEOUTS, GEM_URLS } from './GeMSelectors';
import type { GeMAdvancedParams } from './GeMTypes';
import { PortalError } from '../PortalAdapter';
import { env } from '../../../config/env';

/**
 * Browser and session management for GeM. Navigation, retries, timeouts,
 * page lifecycle. Knows nothing about tender semantics — it returns raw HTML
 * for GeMParser to interpret.
 */

/**
 * Launch configuration comes from the validated env module, not from raw
 * process.env.
 *
 * The previous `process.env.PUPPETEER_HEADLESS === 'true'` defaulted to
 * HEADED whenever the variable was unset, so a deployment that simply did not
 * set it would try to open a windowed browser on a server with no display and
 * fail every discovery run. env.puppeteer.headless inverts that default:
 * headless unless explicitly disabled for local debugging.
 */
const LAUNCH_ARGS = [
  // Required in a container: there is no user namespace to sandbox into.
  '--no-sandbox',
  '--disable-setuid-sandbox',
  // /dev/shm is typically 64 MB in Docker; Chromium crashes without this.
  '--disable-dev-shm-usage',
  '--window-size=1920,1080',
  '--disable-blink-features=AutomationControlled',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/** Signals that the portal is refusing us rather than simply having no data. */
const BLOCK_MARKERS = ['captcha', 'access denied', 'unusual traffic', 'are you a robot', 'too many requests'];

export class GeMClient {
  private browser: Browser | null = null;

  /** One browser reused across categories in a run, instead of one per query. */
  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    this.browser = await puppeteer.launch({
      headless: env.puppeteer.headless,
      args: LAUNCH_ARGS,
      // Without this a slim image falls back to a bundled download that was
      // never fetched, and the launch fails with an opaque ENOENT.
      ...(env.puppeteer.executablePath ? { executablePath: env.puppeteer.executablePath } : {}),
      timeout: env.puppeteer.navigationTimeoutMs,
    });
    return this.browser;
  }

  private async newPage(): Promise<Page> {
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(USER_AGENT);
    page.setDefaultTimeout(GEM_TIMEOUTS.selector);
    return page;
  }

  async dispose(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  private classify(err: unknown): PortalError['kind'] {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes('timeout') || msg.includes('waiting for')) return 'timeout';
    if (msg.includes('net::') || msg.includes('econnrefused') || msg.includes('dns')) return 'network';
    return 'unknown';
  }

  private async assertNotBlocked(page: Page, scope: string): Promise<void> {
    const body = (await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '')).toLowerCase();
    const hit = BLOCK_MARKERS.find(m => body.includes(m));
    if (hit) {
      throw new PortalError('gem', scope, `GeM returned an anti-bot page (matched "${hit}")`, 'blocked');
    }
  }

  /** Keyword search. Returns the results container's HTML. */
  async searchByCategory(category: string): Promise<string> {
    let page: Page | null = null;
    try {
      page = await this.newPage();
      await page.goto(GEM_URLS.allBids, {
        waitUntil: 'networkidle2',
        timeout: GEM_TIMEOUTS.navigation,
      });

      await page.waitForSelector(GEM_SELECTORS.searchInput, { visible: true, timeout: GEM_TIMEOUTS.selector });
      await page.type(GEM_SELECTORS.searchInput, category, { delay: 100 });

      await page.waitForSelector(GEM_SELECTORS.searchButton, { visible: true });
      await Promise.all([
        page.click(GEM_SELECTORS.searchButton),
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null),
      ]);

      await this.assertNotBlocked(page, category);
      return await this.readResultsHtml(page);
    } catch (err) {
      if (err instanceof PortalError) throw err;
      throw new PortalError('gem', category, (err as Error).message, this.classify(err));
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  /** Advanced search driven by GeM's own tabbed form. */
  async searchAdvanced(params: GeMAdvancedParams): Promise<string> {
    const scope = `advanced:${params.activeTab}`;
    let page: Page | null = null;
    try {
      page = await this.newPage();
      await page.goto(GEM_URLS.advancedSearch, {
        waitUntil: 'networkidle2',
        timeout: GEM_TIMEOUTS.navigation,
      });

      const tabSelector = GEM_SELECTORS.tabs[params.activeTab];
      if (tabSelector) {
        await page.waitForSelector(tabSelector);
        await page.click(tabSelector);
        await new Promise(r => setTimeout(r, GEM_TIMEOUTS.settle));
      }

      switch (params.activeTab) {
        case 'MINISTRY':
          if (params.ministry) await this.fillSelect2(page, GEM_SELECTORS.fields.ministry, params.ministry);
          if (params.organization) await this.fillSelect2(page, GEM_SELECTORS.fields.organization, params.organization);
          break;
        case 'BID_DETAILS':
          if (params.bidNo) await page.type(GEM_SELECTORS.fields.bidNo, params.bidNo);
          break;
        case 'LOCATION':
          if (params.state) await this.fillSelect2(page, GEM_SELECTORS.fields.state, params.state);
          if (params.city) await this.fillSelect2(page, GEM_SELECTORS.fields.city, params.city);
          break;
        case 'BOQ':
          if (params.boqTitle) await page.type(GEM_SELECTORS.fields.boqTitle, params.boqTitle);
          break;
      }

      await page.click(GEM_SELECTORS.tabSubmit[params.activeTab]);

      await page
        .waitForFunction(
          (sel: string) => document.querySelectorAll(sel).length > 0,
          { timeout: GEM_TIMEOUTS.results },
          `${GEM_SELECTORS.resultsContainer} ${GEM_SELECTORS.card}`
        )
        .catch(async () => {
          // No cards may mean a genuinely empty result set — check for a block
          // page before deciding.
          await this.assertNotBlocked(page!, scope);
        });

      return await this.readResultsHtml(page);
    } catch (err) {
      if (err instanceof PortalError) throw err;
      throw new PortalError('gem', scope, (err as Error).message, this.classify(err));
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  private async readResultsHtml(page: Page): Promise<string> {
    return page.evaluate((sel: string) => {
      const container = document.querySelector(sel);
      return container ? container.innerHTML : '';
    }, GEM_SELECTORS.resultsContainer);
  }

  private async fillSelect2(page: Page, containerSelector: string, value: string): Promise<void> {
    try {
      const container = await page.$(containerSelector);
      if (!container) return;
      await container.click();
      await page.waitForSelector(GEM_SELECTORS.select2Field, { visible: true });
      await page.type(GEM_SELECTORS.select2Field, value);
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 500));
    } catch {
      console.warn(`[GeMClient] could not fill select2 ${containerSelector}`);
    }
  }
}
