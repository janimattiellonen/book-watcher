import { linkListenerBook, upsertFromResult, upsertOffer } from '../db/books.js';
import { activateListener, type Listener, setLastRunAt } from '../db/listeners.js';
import type { Db } from '../db/pool.js';
import {
  finishRun,
  hadResultsBefore,
  type RunKind,
  type RunOutcome,
  startRun,
} from '../db/runs.js';
import type { SearchQuery, SearchResult, SourceId } from '../sources/types.js';
import { inPriceRange, isListenersBook, toEur } from './matching.js';

export interface SourceSearchResult {
  results: SearchResult[];
  /** True when the store had more results than the page limit let the search load. */
  truncated: boolean;
}

/** Searches one source. The live implementation drives the browser; tests pass fakes. */
export type SourceSearch = (source: SourceId, query: SearchQuery) => Promise<SourceSearchResult>;

export interface RunDeps {
  db: Db;
  search: SourceSearch;
  now: () => Date;
  /** The polite delay before switching to the next source (spec US-6). */
  pause: () => Promise<void>;
  sekToEur: number;
  log: (message: string) => void;
}

export interface SourceRunSummary {
  source: SourceId;
  status: RunOutcome['status'];
  results: number | null;
  newBooks: number | null;
  error: string | null;
}

export interface RunSummary {
  kind: RunKind;
  sources: SourceRunSummary[];
  /** The seed succeeded on every source and the listener is now active. */
  activated: boolean;
}

/**
 * Runs one listener: a seed while it is pending, otherwise a watch run. Each source is
 * searched in turn and recorded as its own `runs` row. A seed records books silently;
 * a watch run queues new suggestions for the digest. The listener becomes active only
 * if the seed succeeded on every source, and `last_run_at` is set whatever happened.
 * Never sends e-mail and never changes a book's status.
 */
export async function runListener(deps: RunDeps, listener: Listener): Promise<RunSummary> {
  const kind: RunKind = listener.seedState === 'pending' ? 'seed' : 'watch';
  const summaries: SourceRunSummary[] = [];
  let activated = false;

  try {
    for (const [index, source] of listener.sources.entries()) {
      if (index > 0) await deps.pause();
      summaries.push(await runSource(deps, listener, source, kind));
    }

    if (kind === 'seed' && summaries.every((summary) => summary.status === 'ok')) {
      await activateListener(deps.db, listener.id, deps.now());
      activated = true;
    }
  } finally {
    await setLastRunAt(deps.db, listener.id, deps.now());
  }

  return { kind, sources: summaries, activated };
}

async function runSource(
  deps: RunDeps,
  listener: Listener,
  source: SourceId,
  kind: RunKind,
): Promise<SourceRunSummary> {
  const { db } = deps;
  const runId = await startRun(db, { listenerId: listener.id, source, kind, now: deps.now() });
  const finish = async (outcome: Omit<RunOutcome, 'now'>): Promise<SourceRunSummary> => {
    await finishRun(db, runId, { ...outcome, now: deps.now() });
    if (outcome.status !== 'ok') {
      deps.log(
        `${listener.name} / ${source}: ${outcome.status}${outcome.error ? `, ${outcome.error}` : ''}`,
      );
    }
    return { source, ...outcome };
  };

  let found: SourceSearchResult;
  try {
    found = await deps.search(source, {
      author: listener.author,
      language: listener.language,
      format: listener.format,
    });
  } catch (error) {
    return finish({ status: 'failed', results: null, newBooks: null, error: describe(error) });
  }

  const results = found.results.length;
  if (results === 0 && (await hadResultsBefore(db, listener.id, source))) {
    return finish({
      status: 'suspicious',
      results,
      newBooks: null,
      error: 'No results, although earlier searches had some',
    });
  }
  if (found.truncated) {
    deps.log(
      `${listener.name} / ${source}: stopped at the page limit with more results left; ` +
        'raise MAX_PAGES_PER_SEARCH to see them all',
    );
  }

  try {
    const newBooks = await recordResults(deps, listener, kind, found.results);
    return finish({ status: 'ok', results, newBooks, error: null });
  } catch (error) {
    return finish({ status: 'failed', results, newBooks: null, error: describe(error) });
  }
}

/**
 * Stores the listener's books from one search in a single transaction, so a failure
 * leaves nothing half written. Returns how many books were not in the database before.
 */
async function recordResults(
  deps: RunDeps,
  listener: Listener,
  kind: RunKind,
  results: SearchResult[],
): Promise<number> {
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const now = deps.now();
    let newBooks = 0;
    for (const result of results) {
      if (!isListenersBook(listener, result)) continue;
      const priceEur = toEur(result.price, result.currency, deps.sekToEur);
      const { book, created } = await upsertFromResult(client, result, {
        inRange: inPriceRange(priceEur, listener.minPriceEur, listener.maxPriceEur),
        notify: kind === 'watch',
        now,
      });
      if (created) newBooks++;
      await upsertOffer(client, {
        bookId: book.id,
        source: result.source,
        url: result.url,
        price: result.price,
        currency: result.currency,
        priceEur,
        now,
      });
      await linkListenerBook(client, {
        listenerId: listener.id,
        bookId: book.id,
        foundDuringSeed: kind === 'seed',
        now,
      });
    }
    await client.query('COMMIT');
    return newBooks;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
