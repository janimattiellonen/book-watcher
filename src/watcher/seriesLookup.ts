import type { Listener } from '../db/listeners.js';
import type { Db } from '../db/pool.js';
import { finishRun, startRun } from '../db/runs.js';
import { applyBookSeries, listLookupQueue, markSeriesChecked } from '../db/series.js';
import type { AdlibrisBook } from '../sources/adlibrisBook.js';
import { BlockedError, UnexpectedPageError } from '../sources/types.js';

/** Loads and parses one Adlibris book page. The live one uses the run's browser. */
export type LoadBookPage = (url: string) => Promise<AdlibrisBook>;

export interface SeriesLookupDeps {
  db: Db;
  loadBookPage: LoadBookPage;
  /** The polite delay, taken before every page load. */
  pause: () => Promise<void>;
  now: () => Date;
  /** Book pages loaded per listener run at most (`MAX_SERIES_LOOKUPS_PER_RUN`). */
  maxLookups: number;
  log: (message: string) => void;
}

export interface SeriesLookupSummary {
  status: 'ok' | 'failed';
  /** Book pages loaded. */
  pages: number;
  /** Books that got a series from their page. */
  found: number;
  error: string | null;
}

/**
 * The series lookups at the end of a listener run (series spec US-S2). Loads the Adlibris
 * book pages of the listener's books that still have no series, newest first, up to the
 * cap, with the polite delay before each. A page read successfully marks its book as
 * looked up, with or without a series. A page that fails to load, or isn't the expected
 * book page, is skipped and retried on a later run. A `BlockedError` ends the lookups for
 * this run: the rest wait for the next one.
 *
 * Logged as one `series` run when there was anything to look up; returns null when there
 * wasn't. Never touches a book's status or its notification flags. Never throws: a
 * failure outside the page loads, a database error say, is logged and returned as a
 * failed summary, so it can't fail the listener run around it (series spec, Boundaries).
 */
export async function lookupSeries(
  deps: SeriesLookupDeps,
  listener: Listener,
): Promise<SeriesLookupSummary | null> {
  try {
    return await lookUpQueuedBooks(deps, listener);
  } catch (failure) {
    const error = describe(failure);
    deps.log(`${listener.name} / series lookup: stopped, ${error}`);
    return { status: 'failed', pages: 0, found: 0, error };
  }
}

async function lookUpQueuedBooks(
  deps: SeriesLookupDeps,
  listener: Listener,
): Promise<SeriesLookupSummary | null> {
  if (deps.maxLookups <= 0) return null;
  const queue = await listLookupQueue(deps.db, listener.id, deps.maxLookups);
  if (queue.length === 0) return null;

  const runId = await startRun(deps.db, {
    listenerId: listener.id,
    source: 'adlibris',
    kind: 'series',
    now: deps.now(),
  });
  let pages = 0;
  let found = 0;
  let error: string | null = null;

  try {
    for (const candidate of queue) {
      await deps.pause();
      let page: AdlibrisBook;
      try {
        pages++;
        page = await deps.loadBookPage(candidate.url);
        if (candidate.isbn && page.isbn && page.isbn !== candidate.isbn) {
          throw new UnexpectedPageError(
            `${candidate.url} shows ISBN ${page.isbn}, not ${candidate.isbn}`,
          );
        }
      } catch (failure) {
        if (failure instanceof BlockedError) {
          error = describe(failure);
          break;
        }
        deps.log(
          `${listener.name} / series lookup: skipped ${candidate.url}, ${describe(failure)}`,
        );
        continue;
      }

      if (
        page.series &&
        (await applyBookSeries(deps.db, {
          bookId: candidate.bookId,
          authors: candidate.authors,
          series: page.series,
          source: 'adlibris',
        }))
      ) {
        found++;
      }
      await markSeriesChecked(deps.db, candidate.bookId, deps.now());
    }
  } catch (failure) {
    // A database error: still close the run, so it doesn't stay 'running'.
    error = describe(failure);
  }

  const summary: SeriesLookupSummary = { status: error ? 'failed' : 'ok', pages, found, error };
  await finishRun(deps.db, runId, {
    status: summary.status,
    results: pages,
    newBooks: found,
    error,
    now: deps.now(),
  });
  if (error) deps.log(`${listener.name} / series lookup: stopped, ${error}`);
  return summary;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
