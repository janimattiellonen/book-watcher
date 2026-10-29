import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listBooks, setStatus } from '../db/books.js';
import { createListener, getListener, type Listener, type ListenerInput } from '../db/listeners.js';
import { listRecentRuns } from '../db/runs.js';
import { createTestPool, truncateAll } from '../db/testPool.js';
import { BlockedError, type SearchResult, type SourceId } from '../sources/types.js';
import { type RunDeps, runListener, type SourceSearchResult } from './runListener.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

const seedTime = new Date('2026-10-29T12:00:00Z');
const watchTime = new Date('2026-10-30T12:00:00Z');

const listenerInput: ListenerInput = {
  name: 'Viveca Sten',
  author: 'Viveca Sten',
  language: 'sv',
  format: 'ebook',
  minPriceEur: null,
  maxPriceEur: 10,
  sources: ['bokus', 'adlibris'],
  enabled: true,
};

function book(isbn: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    source: 'bokus',
    title: `Book ${isbn.slice(-3)}`,
    authors: ['Viveca Sten'],
    isbn,
    format: 'ebook',
    language: 'sv',
    price: 59, // 5.13 EUR at the test rate
    currency: 'SEK',
    url: `https://www.bokus.com/bok/${isbn}/`,
    coverUrl: null,
    ...overrides,
  };
}

function adlibris(isbn: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return book(isbn, {
    source: 'adlibris',
    language: null,
    price: 6.99,
    currency: 'EUR',
    url: `https://www.adlibris.com/fi/kirja/book-${isbn}`,
    ...overrides,
  });
}

type FakeSource = SearchResult[] | Error;

/** Runs a listener against fake sources, at a fixed time, recording the searches made. */
async function run(
  listener: Listener,
  fakes: Partial<Record<SourceId, FakeSource>>,
  now = seedTime,
) {
  const searched: SourceId[] = [];
  const log: string[] = [];
  let pauses = 0;
  const deps: RunDeps = {
    db,
    search: (source): Promise<SourceSearchResult> => {
      searched.push(source);
      const fake = fakes[source] ?? [];
      return fake instanceof Error
        ? Promise.reject(fake)
        : Promise.resolve({ results: fake, truncated: false });
    },
    now: () => now,
    pause: () => {
      pauses++;
      return Promise.resolve();
    },
    sekToEur: 0.087,
    log: (message) => log.push(message),
  };
  const summary = await runListener(deps, listener);
  return { summary, searched, log, pauses };
}

async function reload(listener: Listener): Promise<Listener> {
  const reloaded = await getListener(db, listener.id);
  if (!reloaded) throw new Error('listener vanished');
  return reloaded;
}

async function allBooks() {
  const { rows } = await db.query<{
    isbn: string;
    status: string;
    notify_pending: boolean;
    eligible_at: Date | null;
  }>('SELECT isbn, status, notify_pending, eligible_at FROM books ORDER BY isbn');
  return rows;
}

describe('runListener: seed', () => {
  it('records every matching book silently and activates the listener', async () => {
    const listener = await createListener(db, listenerInput);

    const { summary, searched, pauses } = await run(listener, {
      bokus: [book('9789100000001'), book('9789100000002')],
      adlibris: [adlibris('9789100000001'), adlibris('9789100000003')],
    });

    expect(summary).toMatchObject({ kind: 'seed', activated: true });
    expect(searched).toEqual(['bokus', 'adlibris']);
    expect(pauses).toBe(1);

    const books = await allBooks();
    expect(books.map((row) => row.isbn)).toEqual([
      '9789100000001',
      '9789100000002',
      '9789100000003',
    ]);
    expect(books.every((row) => row.status === 'new' && !row.notify_pending)).toBe(true);

    const { rows: links } = await db.query<{ found_during_seed: boolean }>(
      'SELECT found_during_seed FROM listener_books WHERE listener_id = $1',
      [listener.id],
    );
    expect(links).toHaveLength(3);
    expect(links.every((link) => link.found_during_seed)).toBe(true);

    const [shared] = await listBooks(db, { status: 'new' }).then((items) =>
      items.filter((item) => item.isbn === '9789100000001'),
    );
    expect(shared.offers.map((offer) => offer.source)).toEqual(['adlibris', 'bokus']);
    expect(shared.offers.find((offer) => offer.source === 'bokus')?.priceEur).toBe(5.13);

    expect(await reload(listener)).toMatchObject({
      seedState: 'active',
      seededAt: seedTime,
      lastRunAt: seedTime,
    });
  });

  it('records one run per source with the result count and the new books', async () => {
    const listener = await createListener(db, listenerInput);

    await run(listener, {
      bokus: [book('9789100000001'), book('9789100000002', { authors: ['Camilla Sten'] })],
      adlibris: [adlibris('9789100000001')],
    });

    const runs = await listRecentRuns(db, { limit: 10 });
    expect(
      runs.map(({ source, kind, status, results, newBooks }) => ({
        source,
        kind,
        status,
        results,
        newBooks,
      })),
    ).toEqual(
      expect.arrayContaining([
        { source: 'bokus', kind: 'seed', status: 'ok', results: 2, newBooks: 1 },
        { source: 'adlibris', kind: 'seed', status: 'ok', results: 1, newBooks: 0 },
      ]),
    );
  });

  it('leaves the listener pending when one source fails, and records the error', async () => {
    const listener = await createListener(db, listenerInput);

    const { summary, log } = await run(listener, {
      bokus: [book('9789100000001')],
      adlibris: new BlockedError('Security checkpoint did not clear'),
    });

    expect(summary.activated).toBe(false);
    expect(summary.sources).toEqual([
      { source: 'bokus', status: 'ok', results: 1, newBooks: 1, error: null },
      {
        source: 'adlibris',
        status: 'failed',
        results: null,
        newBooks: null,
        error: 'BlockedError: Security checkpoint did not clear',
      },
    ]);
    expect(log).toEqual([
      'Viveca Sten / adlibris: failed, BlockedError: Security checkpoint did not clear',
    ]);
    expect(await reload(listener)).toMatchObject({
      seedState: 'pending',
      seededAt: null,
      lastRunAt: seedTime,
    });
    const [failed] = await listRecentRuns(db, { limit: 10 }).then((runs) =>
      runs.filter((r) => r.source === 'adlibris'),
    );
    expect(failed).toMatchObject({ status: 'failed', finishedAt: seedTime });
  });

  it('stores books outside the price range without making them suggestions', async () => {
    const listener = await createListener(db, { ...listenerInput, sources: ['bokus'] });

    await run(listener, { bokus: [book('9789100000001', { price: 199 })] });

    expect(await allBooks()).toMatchObject([{ isbn: '9789100000001', eligible_at: null }]);
    expect(await listBooks(db, { status: 'new' })).toEqual([]);
  });
});

describe('runListener: watch', () => {
  async function seeded(fakes: Partial<Record<SourceId, FakeSource>>) {
    const listener = await createListener(db, listenerInput);
    await run(listener, fakes);
    return reload(listener);
  }

  it('queues new books and in-range price drops, but not books it already knew', async () => {
    const listener = await seeded({
      bokus: [book('9789100000001'), book('9789100000002', { price: 199 })],
      adlibris: [adlibris('9789100000001')],
    });

    const { summary } = await run(
      listener,
      {
        bokus: [book('9789100000001'), book('9789100000002'), book('9789100000003')],
        adlibris: [adlibris('9789100000001')],
      },
      watchTime,
    );

    expect(summary).toMatchObject({ kind: 'watch', activated: false });
    expect(await allBooks()).toEqual([
      { isbn: '9789100000001', status: 'new', notify_pending: false, eligible_at: seedTime },
      { isbn: '9789100000002', status: 'new', notify_pending: true, eligible_at: watchTime },
      { isbn: '9789100000003', status: 'new', notify_pending: true, eligible_at: watchTime },
    ]);
    const { rows: links } = await db.query<{ found_during_seed: boolean }>(
      `SELECT found_during_seed FROM listener_books lb JOIN books b ON b.id = lb.book_id
       WHERE b.isbn = '9789100000003'`,
    );
    expect(links).toEqual([{ found_during_seed: false }]);
    expect((await reload(listener)).lastRunAt).toEqual(watchTime);
  });

  it('never changes a book status', async () => {
    const listener = await seeded({ bokus: [book('9789100000001')] });
    const [known] = await listBooks(db, { status: 'new' });
    await setStatus(db, [known.id], 'rejected');

    await run(listener, { bokus: [book('9789100000001', { price: 29 })] }, watchTime);

    expect(await allBooks()).toMatchObject([{ status: 'rejected', notify_pending: false }]);
  });

  it('marks a source suspicious when it returns nothing after earlier results, and writes nothing', async () => {
    const listener = await seeded({ bokus: [book('9789100000001')], adlibris: [] });

    const { summary } = await run(listener, { bokus: [], adlibris: [] }, watchTime);

    expect(summary.sources.map(({ source, status }) => ({ source, status }))).toEqual([
      { source: 'bokus', status: 'suspicious' },
      // Adlibris never had results for this listener, so an empty search is just empty.
      { source: 'adlibris', status: 'ok' },
    ]);
    expect(await allBooks()).toHaveLength(1);
    expect((await reload(listener)).lastRunAt).toEqual(watchTime);
  });

  it('updates the offer price of a known book', async () => {
    const listener = await seeded({ bokus: [book('9789100000001')] });

    await run(listener, { bokus: [book('9789100000001', { price: 49 })] }, watchTime);

    const { rows } = await db.query<{ price: number; last_seen_at: Date }>(
      'SELECT price, last_seen_at FROM book_offers',
    );
    expect(rows).toEqual([{ price: 49, last_seen_at: watchTime }]);
  });
});

describe('runListener: failures', () => {
  it('rolls back a source whose writes fail, and still sets last_run_at', async () => {
    const listener = await createListener(db, { ...listenerInput, sources: ['bokus'] });

    // A source the offers table rejects stands in for any write failure mid-source.
    const { summary } = await run(listener, {
      bokus: [book('9789100000001'), book('9789100000002', { source: 'nope' as SourceId })],
    });

    expect(summary.sources).toMatchObject([{ source: 'bokus', status: 'failed', results: 2 }]);
    expect(await allBooks()).toEqual([]);
    expect(await reload(listener)).toMatchObject({ seedState: 'pending', lastRunAt: seedTime });
  });
});
