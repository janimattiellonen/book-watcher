import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { SearchResult, SourceId } from '../sources/types.js';
import {
  linkListenerBook,
  listBooks,
  listListenerBooks,
  listSeriesBooks,
  setStatus,
  upsertFromResult,
  upsertOffer,
} from './books.js';
import { createListener } from './listeners.js';
import {
  applyBookSeries,
  countWaitingLookups,
  getSeries,
  listLookupQueue,
  listSeries,
  markSeriesChecked,
} from './series.js';
import { createTestPool, truncateAll } from './testPool.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

const at = (minute: number) => new Date(Date.UTC(2026, 9, 31, 12, minute));

async function listener(name = 'Satu Rämö'): Promise<number> {
  const { id } = await createListener(db, {
    name,
    author: name,
    language: 'sv',
    format: 'ebook',
    minPriceEur: null,
    maxPriceEur: null,
    sources: ['adlibris', 'bokus'],
    enabled: true,
  });
  return id;
}

/** A book with an offer on each given source, linked to the listener at `minute`. */
async function book(
  listenerId: number,
  {
    isbn,
    title = 'Hildur',
    authors = ['Satu Rämö'],
    sources = ['adlibris'],
    minute = 0,
  }: {
    isbn: string;
    title?: string;
    authors?: string[];
    sources?: SourceId[];
    minute?: number;
  },
): Promise<number> {
  const result: SearchResult = {
    source: sources[0],
    title,
    authors,
    isbn,
    format: 'ebook',
    language: 'sv',
    price: 10,
    currency: 'EUR',
    url: `https://example.com/${isbn}`,
    coverUrl: null,
    series: null,
    publishedYear: null,
  };
  const { book: created } = await upsertFromResult(db, result, {
    inRange: true,
    notify: false,
    now: at(minute),
  });
  for (const source of sources) {
    await upsertOffer(db, {
      bookId: created.id,
      source,
      url: `https://www.${source}.example/${isbn}`,
      price: 10,
      currency: 'EUR',
      priceEur: 10,
      now: at(minute),
    });
  }
  await linkListenerBook(db, {
    listenerId,
    bookId: created.id,
    foundDuringSeed: true,
    now: at(minute),
  });
  return created.id;
}

const seriesOf = async (bookId: number) =>
  (
    await db.query<{ name: string | null; part: number | null; source: string | null }>(
      `SELECT s.name, b.series_part AS part, b.series_source AS source
       FROM books b LEFT JOIN series s ON s.id = b.series_id WHERE b.id = $1`,
      [bookId],
    )
  ).rows[0];

const countSeries = async () =>
  (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM series')).rows[0].n;

describe('applyBookSeries', () => {
  it('creates a series once and puts both stores’ names of it together', async () => {
    const l = await listener();
    const hildur = await book(l, { isbn: '9789137506579' });
    const tinna = await book(l, { isbn: '9789137164328', title: 'Tinna' });

    expect(
      await applyBookSeries(db, {
        bookId: hildur,
        authors: ['Satu Rämö'],
        series: { name: 'Hildur-serien', part: 1 },
        source: 'adlibris',
      }),
    ).toBe(true);
    await applyBookSeries(db, {
      bookId: tinna,
      authors: ['Rämö, Satu'],
      series: { name: 'Hildur', part: 5 },
      source: 'bokus',
    });

    expect(await countSeries()).toBe(1);
    // The display name is the first one seen.
    expect(await seriesOf(tinna)).toEqual({ name: 'Hildur-serien', part: 5, source: 'bokus' });
  });

  it('keeps two authors’ series of the same name apart', async () => {
    const l = await listener();
    const first = await book(l, { isbn: '9789137506579' });
    const second = await book(l, { isbn: '9789137164328', authors: ['Someone Else'] });
    for (const [bookId, authors] of [
      [first, ['Satu Rämö']],
      [second, ['Someone Else']],
    ] as const) {
      await applyBookSeries(db, {
        bookId,
        authors,
        series: { name: 'Hildur', part: 1 },
        source: 'bokus',
      });
    }
    expect(await countSeries()).toBe(2);
  });

  it('lets Bokus replace an Adlibris series, but not the other way round', async () => {
    const l = await listener();
    const bookId = await book(l, { isbn: '9789137506579' });
    const apply = (source: SourceId, name: string, part: number) =>
      applyBookSeries(db, { bookId, authors: ['Satu Rämö'], series: { name, part }, source });

    await apply('adlibris', 'Hildur-serien', 1);
    expect(await apply('bokus', 'Hildur', 2)).toBe(true);
    expect(await seriesOf(bookId)).toEqual({ name: 'Hildur-serien', part: 2, source: 'bokus' });

    expect(await apply('adlibris', 'Other', 9)).toBe(false);
    expect(await seriesOf(bookId)).toEqual({ name: 'Hildur-serien', part: 2, source: 'bokus' });
  });

  it('reports no change when the same series is applied again', async () => {
    const l = await listener();
    const bookId = await book(l, { isbn: '9789137506579' });
    const apply = () =>
      applyBookSeries(db, {
        bookId,
        authors: ['Satu Rämö'],
        series: { name: 'Hildur', part: 1 },
        source: 'bokus',
      });
    expect(await apply()).toBe(true);
    expect(await apply()).toBe(false);
  });

  it('leaves a book without authors alone', async () => {
    const l = await listener();
    const bookId = await book(l, { isbn: '9789137506579' });
    expect(
      await applyBookSeries(db, {
        bookId,
        authors: [],
        series: { name: 'Hildur', part: 1 },
        source: 'bokus',
      }),
    ).toBe(false);
    expect(await countSeries()).toBe(0);
  });
});

describe('listLookupQueue and markSeriesChecked', () => {
  it('queues the listener’s Adlibris books without a series or a lookup, newest first', async () => {
    const l = await listener();
    const other = await listener('Viveca Sten');
    const oldest = await book(l, { isbn: '9789137506579', minute: 1 });
    const newest = await book(l, { isbn: '9789137164328', minute: 3 });
    const checked = await book(l, { isbn: '9789137000001', minute: 4 });
    const inSeries = await book(l, { isbn: '9789137000002', minute: 5 });
    await book(l, { isbn: '9789137000003', sources: ['bokus'], minute: 6 });
    await book(other, { isbn: '9789137000004', minute: 7 });

    await markSeriesChecked(db, checked, at(10));
    await applyBookSeries(db, {
      bookId: inSeries,
      authors: ['Satu Rämö'],
      series: { name: 'Hildur', part: 1 },
      source: 'bokus',
    });

    const queue = await listLookupQueue(db, l, 10);
    expect(queue.map((candidate) => candidate.bookId)).toEqual([newest, oldest]);
    expect(queue[0]).toEqual({
      bookId: newest,
      isbn: '9789137164328',
      authors: ['Satu Rämö'],
      url: 'https://www.adlibris.example/9789137164328',
    });
    expect((await listLookupQueue(db, l, 1)).map((candidate) => candidate.bookId)).toEqual([
      newest,
    ]);
  });
});

describe('listSeries and getSeries', () => {
  it('lists series with books, by name, with their books counted by status', async () => {
    const l = await listener();
    const a = await book(l, { isbn: '9789137506579' });
    const b = await book(l, { isbn: '9789137164328' });
    const c = await book(l, { isbn: '9789137000001' });
    const apply = (bookId: number, name: string, part: number) =>
      applyBookSeries(db, {
        bookId,
        authors: ['Satu Rämö'],
        series: { name, part },
        source: 'bokus',
      });
    await apply(a, 'Hildur', 1);
    await apply(b, 'Hildur', 2);
    await apply(c, 'Arctic', 1);
    await setStatus(db, [a], 'read');

    const series = await listSeries(db);
    expect(series.map((s) => s.name)).toEqual(['Arctic', 'Hildur']);
    expect(series[1]).toMatchObject({
      author: 'Satu Rämö',
      authorKey: 'satu ramo',
      counts: { new: 1, accepted: 0, read: 1, rejected: 0 },
    });
    expect(await getSeries(db, series[1].id)).toEqual({
      id: series[1].id,
      name: 'Hildur',
      author: 'Satu Rämö',
      authorKey: 'satu ramo',
    });
    expect(await getSeries(db, 999)).toBeNull();
  });
});

describe('books with their series', () => {
  it('lists a series’ books last part first, books without a part last, by title', async () => {
    const l = await listener();
    const third = await book(l, { isbn: '9789137000003', title: 'C' });
    const first = await book(l, { isbn: '9789137000001', title: 'A' });
    const noPartB = await book(l, { isbn: '9789137000005', title: 'b' });
    const noPartA = await book(l, { isbn: '9789137000004', title: 'A extra' });
    const apply = (bookId: number, part: number | null) =>
      applyBookSeries(db, {
        bookId,
        authors: ['Satu Rämö'],
        series: { name: 'Hildur', part },
        source: 'bokus',
      });
    await apply(third, 3);
    await apply(first, 1);
    await apply(noPartB, null);
    await apply(noPartA, null);

    const [{ id: seriesId }] = await listSeries(db);
    const books = await listSeriesBooks(db, seriesId);
    expect(books.map((b) => b.id)).toEqual([third, first, noPartA, noPartB]);
    expect(books[0].series).toEqual({ id: seriesId, name: 'Hildur', part: 3 });
    expect(books[2].series).toEqual({ id: seriesId, name: 'Hildur', part: null });
  });

  it('gives listed books their series, and filters a view by series and listener', async () => {
    const satu = await listener();
    const viveca = await listener('Viveca Sten');
    const inSeries = await book(satu, { isbn: '9789137506579' });
    await book(satu, { isbn: '9789137164328' });
    const otherListener = await book(viveca, { isbn: '9789137000001' });
    for (const bookId of [inSeries, otherListener]) {
      await applyBookSeries(db, {
        bookId,
        authors: ['Satu Rämö'],
        series: { name: 'Hildur', part: 1 },
        source: 'bokus',
      });
    }
    const [{ id: seriesId }] = await listSeries(db);

    const all = await listBooks(db, { status: 'new' });
    expect(
      all
        .filter((b) => b.series)
        .map((b) => b.id)
        .sort(),
    ).toEqual([inSeries, otherListener].sort());
    expect((await listBooks(db, { status: 'new', seriesId })).map((b) => b.id).sort()).toEqual(
      [inSeries, otherListener].sort(),
    );
    expect(
      (await listBooks(db, { status: 'new', seriesId, listenerId: satu })).map((b) => b.id),
    ).toEqual([inSeries]);

    const listenerBooks = await listListenerBooks(db, satu);
    expect(listenerBooks.find((b) => b.id === inSeries)?.series).toEqual({
      id: seriesId,
      name: 'Hildur',
      part: 1,
    });
  });
});

describe('countWaitingLookups', () => {
  it('counts the author’s Adlibris books still waiting for a lookup', async () => {
    const l = await listener();
    await book(l, { isbn: '9789137000001', authors: ['Rämö, Satu'] });
    const checked = await book(l, { isbn: '9789137000002' });
    await book(l, { isbn: '9789137000003', sources: ['bokus'] });
    await book(l, { isbn: '9789137000004', authors: ['Viveca Sten'] });
    await markSeriesChecked(db, checked, at(10));

    expect(await countWaitingLookups(db, 'satu ramo')).toBe(1);
    expect(await countWaitingLookups(db, 'viveca sten')).toBe(1);
    expect(await countWaitingLookups(db, 'nobody')).toBe(0);
  });
});
