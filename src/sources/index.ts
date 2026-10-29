import type { Browser, Page } from 'playwright';

import { adlibrisSearchUrl, parseAdlibris } from './adlibris.js';
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
      const cards = page.locator('article[data-test-id="product-card-buy"]');
      const before = await cards.count();
      await page.locator('[data-test-id="listing-next-page"]').click();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll('article[data-test-id="product-card-buy"]').length > count,
        before,
        { timeout: 30_000 },
      );
      await settle(page);
    },
  },
  adlibris: {
    id: 'adlibris',
    locale: 'fi-FI',
    searchUrl: adlibrisSearchUrl,
    parse: parseAdlibris,
    // Pagination not yet seen on a captured page; parseAdlibris reports hasMore: false.
    loadMore: () => Promise.resolve(),
  },
};

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
