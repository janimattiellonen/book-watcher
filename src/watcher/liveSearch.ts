import { fetchAdlibrisBook } from '../sources/adlibrisBook.js';
import { launchBrowser, politeDelay } from '../sources/browser.js';
import { searchSource, sources } from '../sources/index.js';
import type { SourceSearch } from './runListener.js';
import type { LoadBookPage } from './seriesLookup.js';

export interface LiveSearchOptions {
  maxPagesPerSearch: number;
  /** Aborting closes the browser, so the run's remaining searches fail fast. */
  signal?: AbortSignal;
  /** See `launchBrowser`. */
  handleSignals?: boolean;
}

/**
 * Gives `fn` a search and an Adlibris book-page loader that drive a real browser against
 * the stores. The browser is launched for this one run and closed afterwards, whatever
 * happens (spec decision 2).
 */
export async function withLiveSearch<T>(
  { maxPagesPerSearch, signal, handleSignals }: LiveSearchOptions,
  fn: (search: SourceSearch, pause: () => Promise<void>, loadBookPage: LoadBookPage) => Promise<T>,
): Promise<T> {
  const browser = await launchBrowser({ handleSignals });
  const abort = () => void browser.close();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const search: SourceSearch = async (source, query) => {
      signal?.throwIfAborted();
      const outcome = await searchSource(browser, sources[source], query, maxPagesPerSearch);
      return { results: outcome.page.results, truncated: outcome.truncated };
    };
    const loadBookPage: LoadBookPage = (url) => {
      signal?.throwIfAborted();
      return fetchAdlibrisBook(browser, url);
    };
    return await fn(search, () => politeDelay(), loadBookPage);
  } finally {
    signal?.removeEventListener('abort', abort);
    await browser.close();
  }
}
