import { launchBrowser, politeDelay } from '../sources/browser.js';
import { searchSource, sources } from '../sources/index.js';
import type { SourceSearch } from './runListener.js';

export interface LiveSearchOptions {
  maxPagesPerSearch: number;
  /** Aborting closes the browser, so the run's remaining searches fail fast. */
  signal?: AbortSignal;
  /** See `launchBrowser`. */
  handleSignals?: boolean;
}

/**
 * Gives `fn` a search that drives a real browser against the stores. The browser is
 * launched for this one run and closed afterwards, whatever happens (spec decision 2).
 */
export async function withLiveSearch<T>(
  { maxPagesPerSearch, signal, handleSignals }: LiveSearchOptions,
  fn: (search: SourceSearch, pause: () => Promise<void>) => Promise<T>,
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
    return await fn(search, () => politeDelay());
  } finally {
    signal?.removeEventListener('abort', abort);
    await browser.close();
  }
}
