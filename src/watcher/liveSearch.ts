import { launchBrowser, politeDelay } from '../sources/browser.js';
import { searchSource, sources } from '../sources/index.js';
import type { SourceSearch } from './runListener.js';

/**
 * Gives `fn` a search that drives a real browser against the stores. The browser is
 * launched for this one run and closed afterwards, whatever happens (spec decision 2).
 */
export async function withLiveSearch<T>(
  maxPagesPerSearch: number,
  fn: (search: SourceSearch, pause: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const browser = await launchBrowser();
  try {
    const search: SourceSearch = async (source, query) => {
      const outcome = await searchSource(browser, sources[source], query, maxPagesPerSearch);
      return { results: outcome.page.results, truncated: outcome.truncated };
    };
    return await fn(search, () => politeDelay());
  } finally {
    await browser.close();
  }
}
