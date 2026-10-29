import type { Browser, Locator, Page } from 'playwright';

import { adlibrisSearchUrl, LOAD_MORE_LABEL, parseAdlibris } from './adlibris.js';
import { bokusSearchUrl, parseBokus } from './bokus.js';
import { newPage, openPage, politeDelay, settle } from './browser.js';
import type { ParsedPage, SearchQuery, SourceId } from './types.js';

export interface Source {
  id: SourceId;
  /** Browser locale to present to the store. */
  locale: string;
  searchUrl(query: SearchQuery): string;
  parse(html: string): ParsedPage;
  /** Loads the next batch of results into the page, or does nothing if there is none. */
  loadMore(page: Page): Promise<void>;
}

export const sources: Record<SourceId, Source> = {
  bokus: {
    id: 'bokus',
    locale: 'sv-SE',
    searchUrl: bokusSearchUrl,
    parse: parseBokus,
    async loadMore(page) {
      await clickAndWaitForMore(
        page,
        'article[data-test-id="product-card-buy"]',
        page.locator('[data-test-id="listing-next-page"]'),
      );
    },
  },
  adlibris: {
    id: 'adlibris',
    locale: 'fi-FI',
    searchUrl: adlibrisSearchUrl,
    parse: parseAdlibris,
    async loadMore(page) {
      await clickAndWaitForMore(
        page,
        'main article',
        page.locator('main button', { hasText: LOAD_MORE_LABEL }),
      );
    },
  },
};

/** Clicks a "load more" control and waits until more result cards are on the page. */
async function clickAndWaitForMore(page: Page, cardSelector: string, button: Locator) {
  const before = await page.locator(cardSelector).count();
  await button.click();
  await page.waitForFunction(
    ([selector, count]) => document.querySelectorAll(selector).length > count,
    [cardSelector, before] as const,
    { timeout: 30_000 },
  );
  await settle(page);
}

export interface SearchOutcome {
  page: ParsedPage;
  /** Page loads and "load more" clicks made, each a request to the store. */
  requests: number;
  /** True when the store still had more results after `maxPages`. */
  truncated: boolean;
  html: string;
}

/**
 * Runs one search against a live store, loading more results until there are none
 * left or `maxPages` loads have been made, with a polite delay before each extra load.
 */
export async function searchSource(
  browser: Browser,
  source: Source,
  query: SearchQuery,
  maxPages: number,
): Promise<SearchOutcome> {
  const page = await newPage(browser, source.locale);
  try {
    await openPage(page, source.searchUrl(query));
    let requests = 1;
    let html = await page.content();
    let parsed = source.parse(html);

    while (parsed.hasMore && requests < maxPages) {
      await politeDelay();
      await source.loadMore(page);
      requests++;
      html = await page.content();
      parsed = source.parse(html);
    }

    return { page: parsed, requests, truncated: parsed.hasMore, html };
  } finally {
    await page.context().close();
  }
}
