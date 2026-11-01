import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { setStatus } from '../db/books.js';
import { createListener, getListener, type Listener, type ListenerInput } from '../db/listeners.js';
import { listRecentRuns } from '../db/runs.js';
import { createTestPool, truncateAll } from '../db/testPool.js';
import type { AdlibrisBook } from '../sources/adlibrisBook.js';
import {
  BlockedError,
  type SearchResult,
  type SourceId,
  UnexpectedPageError,
} from '../sources/types.js';
import { type RunDeps, runListener } from './runListener.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

const seedTime = new Date('2026-10-31T12:00:00Z');
const watchTime = new Date('2026-11-01T12:00:00Z');

const listenerInput: ListenerInput = {
  name: 'Satu Rämö',
  author: 'Satu Rämö',
  language: 'sv',
  format: 'ebook',
  minPriceEur: null,
  maxPriceEur: null,
  sources: ['bokus', 'adlibris'],
  enabled: true,
};

const urlOf = (isbn: string) => `https://www.adlibris.com/fi/kirja/book-${isbn}`;

function result(source: SourceId, isbn: string, series: SearchResult['series'] = null) {
  return {
    source,
    title: `Book ${isbn.slice(-3)}`,
    authors: ['Satu Rämö'],
    isbn,
    format: 'ebook',
    language: source === 'bokus' ? 'sv' : null,
    price: source === 'bokus' ? 59 : 6.99,
    currency: source === 'bokus' ? 'SEK' : 'EUR',
    url: source === 'bokus' ? `https://www.bokus.com/bok/${isbn}/` : urlOf(isbn),
    coverUrl: null,
    series,
  } satisfies SearchResult;
}

/** A book page: a series, none, or an error to throw. */
type FakePage = AdlibrisBook | Error;

/** Runs a listener against fake searches and fake book pages, recording the pages loaded. */
async function run(
  listener: Listener,
  {
    searches,
    pages = {},
    maxSeriesLookups = 20,
    now = seedTime,
  }: {
    searches: Partial<Record<SourceId, SearchResult[] | Error>>;
    pages?: Record<string, FakePage>;
    maxSeriesLookups?: number;
    now?: Date;
  },
) {
  const loaded: string[] = [];
  const log: string[] = [];
  let pauses = 0;
  const deps: RunDeps = {
    db,
    search: (source) => {
      const fake = searches[source] ?? [];
      return fake instanceof Error
        ? Promise.reject(fake)
        : Promise.resolve({ results: fake, truncated: false });
    },
    loadBookPage: (url) => {
      loaded.push(url);
      const isbn = /(\d{13})$/.exec(url)?.[1] ?? null;
      const page = pages[url] ?? { isbn, series: null };
      return page instanceof Error ? Promise.reject(page) : Promise.resolve(page);
    },
    maxSeriesLookups,
    now: () => now,
    pause: () => {
      pauses++;
      return Promise.resolve();
    },
    sekToEur: 0.087,
    log: (message) => log.push(message),
  };
  const summary = await runListener(deps, listener);
  return { summary, loaded, log, pauses };
}

async function reload(listener: Listener): Promise<Listener> {
  const reloaded = await getListener(db, listener.id);
  if (!reloaded) throw new Error('listener vanished');
  return reloaded;
}

async function books() {
  const { rows } = await db.query<{
    isbn: string;
    series: string | null;
    part: number | null;
    source: string | null;
    checked: boolean;
    status: string;
    notify_pending: boolean;
  }>(
    `SELECT b.isbn, s.name AS series, b.series_part AS part, b.series_source AS source,
            b.series_checked_at IS NOT NULL AS checked, b.status, b.notify_pending
     FROM books b LEFT JOIN series s ON s.id = b.series_id ORDER BY b.isbn`,
  );
  return rows;
}

const seriesRuns = async () =>
  (await listRecentRuns(db, { limit: 50 })).filter((run) => run.kind === 'series');

const page = (isbn: string, name: string, part: number | null): AdlibrisBook => ({
  isbn,
  series: { name, part },
});

describe('Bokus series in listener runs', () => {
  it('stores the series of Bokus results on a seed, and fills in known books on a watch run', async () => {
    const listener = await createListener(db, { ...listenerInput, sources: ['bokus'] });
    await run(listener, {
      searches: {
        bokus: [
          result('bokus', '9789137000001', { name: 'Hildur', part: 1 }),
          result('bokus', '9789137000002'),
        ],
      },
    });
    await run(await reload(listener), {
      now: watchTime,
      searches: {
        bokus: [
          result('bokus', '9789137000001', { name: 'Hildur', part: 1 }),
          result('bokus', '9789137000002', { name: 'Hildur', part: 2 }),
        ],
      },
    });

    expect(await books()).toEqual([
      expect.objectContaining({
        isbn: '9789137000001',
        series: 'Hildur',
        part: 1,
        source: 'bokus',
      }),
      expect.objectContaining({
        isbn: '9789137000002',
        series: 'Hildur',
        part: 2,
        source: 'bokus',
      }),
    ]);
  });
});

describe('Adlibris series lookups in listener runs', () => {
  it('looks up the listener’s Adlibris books without a series, and logs a series run', async () => {
    const listener = await createListener(db, listenerInput);
    const { summary, loaded, pauses } = await run(listener, {
      searches: {
        bokus: [result('bokus', '9789137000001', { name: 'Hildur', part: 1 })],
        adlibris: [
          result('adlibris', '9789137000001'),
          result('adlibris', '9789137000002'),
          result('adlibris', '9789137000003'),
        ],
      },
      pages: {
        [urlOf('9789137000002')]: page('9789137000002', 'Hildur-serien', 2),
      },
    });

    // The book Bokus already placed is not looked up.
    expect(loaded.sort()).toEqual([urlOf('9789137000002'), urlOf('9789137000003')]);
    // One pause between the two searches, then one before each page.
    expect(pauses).toBe(3);
    expect(summary.seriesLookup).toEqual({ status: 'ok', pages: 2, found: 1, error: null });
    expect(summary.activated).toBe(true);

    expect(await books()).toEqual([
      expect.objectContaining({ isbn: '9789137000001', series: 'Hildur', checked: false }),
      expect.objectContaining({
        isbn: '9789137000002',
        series: 'Hildur',
        part: 2,
        source: 'adlibris',
        checked: true,
      }),
      expect.objectContaining({ isbn: '9789137000003', series: null, checked: true }),
    ]);
    expect(await seriesRuns()).toEqual([
      expect.objectContaining({ source: 'adlibris', status: 'ok', results: 2, newBooks: 1 }),
    ]);
  });

  it('loads at most the cap per run, and never looks a book up twice', async () => {
    const listener = await createListener(db, listenerInput);
    const adlibrisResults = ['9789137000001', '9789137000002', '9789137000003'].map((isbn) =>
      result('adlibris', isbn),
    );
    const first = await run(listener, {
      searches: { adlibris: adlibrisResults },
      maxSeriesLookups: 2,
    });
    expect(first.loaded).toHaveLength(2);

    const second = await run(await reload(listener), {
      now: watchTime,
      searches: { adlibris: adlibrisResults },
      maxSeriesLookups: 2,
    });
    expect(second.loaded).toHaveLength(1);
    expect(second.loaded[0]).not.toBe(first.loaded[0]);
    expect(second.loaded[0]).not.toBe(first.loaded[1]);

    const third = await run(await reload(listener), {
      now: new Date('2026-11-02T12:00:00Z'),
      searches: { adlibris: adlibrisResults },
      maxSeriesLookups: 2,
    });
    expect(third.loaded).toEqual([]);
    expect(third.summary.seriesLookup).toBeNull();
    expect(await seriesRuns()).toHaveLength(2);
  });

  it('stops at a block, leaving the rest for a later run, and still activates the seed', async () => {
    const listener = await createListener(db, listenerInput);
    const { summary, loaded, log } = await run(listener, {
      searches: {
        adlibris: [result('adlibris', '9789137000001'), result('adlibris', '9789137000002')],
      },
      pages: {
        [urlOf('9789137000001')]: new BlockedError('checkpoint'),
        [urlOf('9789137000002')]: new BlockedError('checkpoint'),
      },
    });

    expect(loaded).toHaveLength(1);
    expect(summary.activated).toBe(true);
    expect((await reload(listener)).seedState).toBe('active');
    expect(summary.seriesLookup).toEqual({
      status: 'failed',
      pages: 1,
      found: 0,
      error: 'BlockedError: checkpoint',
    });
    expect((await books()).every((book) => !book.checked)).toBe(true);
    expect(await seriesRuns()).toEqual([
      expect.objectContaining({ status: 'failed', results: 1, error: 'BlockedError: checkpoint' }),
    ]);
    expect(log.some((line) => line.includes('series lookup: stopped'))).toBe(true);
  });

  it('skips a page that fails or is not the expected book, and goes on with the rest', async () => {
    const listener = await createListener(db, listenerInput);
    const isbns = ['9789137000001', '9789137000002', '9789137000003', '9789137000004'];
    const { loaded, summary, log } = await run(listener, {
      searches: { adlibris: isbns.map((isbn) => result('adlibris', isbn)) },
      pages: {
        // Newest first: 004 is loaded first.
        [urlOf('9789137000004')]: new UnexpectedPageError('not a book page'),
        [urlOf('9789137000003')]: page('9789137999999', 'Wrong book', 1),
        [urlOf('9789137000002')]: new Error('page.goto: Timeout 30000ms exceeded'),
        [urlOf('9789137000001')]: page('9789137000001', 'Hildur-serien', 1),
      },
    });

    expect(loaded).toEqual([...isbns].reverse().map(urlOf));
    expect(summary.seriesLookup).toEqual({ status: 'ok', pages: 4, found: 1, error: null });
    // Only the page that was read successfully is marked; the others wait for a later run.
    expect(await books()).toEqual([
      expect.objectContaining({ isbn: '9789137000001', series: 'Hildur-serien', checked: true }),
      expect.objectContaining({ isbn: '9789137000002', series: null, checked: false }),
      expect.objectContaining({ isbn: '9789137000003', series: null, checked: false }),
      expect.objectContaining({ isbn: '9789137000004', series: null, checked: false }),
    ]);
    expect(log.some((line) => line.includes('Timeout 30000ms exceeded'))).toBe(true);
  });

  it('never queues a book for the digest or changes its status', async () => {
    const listener = await createListener(db, listenerInput);
    await run(listener, {
      searches: { adlibris: [result('adlibris', '9789137000001')] },
      maxSeriesLookups: 0,
    });
    await setStatus(
      db,
      [(await db.query<{ id: number }>('SELECT id FROM books')).rows[0].id],
      'read',
    );

    await run(await reload(listener), {
      now: watchTime,
      searches: { adlibris: [result('adlibris', '9789137000001')] },
      pages: { [urlOf('9789137000001')]: page('9789137000001', 'Hildur-serien', 1) },
    });

    expect(await books()).toEqual([
      expect.objectContaining({ series: 'Hildur-serien', status: 'read', notify_pending: false }),
    ]);
  });

  it('makes no lookups without Adlibris, with the cap at 0, or after a failed Adlibris search', async () => {
    const bokusOnly = await createListener(db, { ...listenerInput, sources: ['bokus'] });
    const bokusRun = await run(bokusOnly, {
      searches: { bokus: [result('bokus', '9789137000001')] },
    });

    const capped = await createListener(db, { ...listenerInput, name: 'Capped' });
    const cappedRun = await run(capped, {
      searches: { adlibris: [result('adlibris', '9789137000002')] },
      maxSeriesLookups: 0,
    });

    // This one has a book waiting from an earlier run, so only the failed search stops it.
    const failing = await createListener(db, { ...listenerInput, name: 'Failing' });
    await run(failing, {
      searches: { adlibris: [result('adlibris', '9789137000003')] },
      maxSeriesLookups: 0,
    });
    const failingRun = await run(await reload(failing), {
      now: watchTime,
      searches: { adlibris: new BlockedError('checkpoint') },
    });

    for (const { loaded, summary } of [bokusRun, cappedRun, failingRun]) {
      expect(loaded).toEqual([]);
      expect(summary.seriesLookup).toBeNull();
    }
    expect(await seriesRuns()).toEqual([]);
  });
});
