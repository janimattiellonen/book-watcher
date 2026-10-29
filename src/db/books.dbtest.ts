import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { SearchResult } from '../sources/types.js';
import {
  linkListenerBook,
  listBooks,
  setStatus,
  upsertFromResult,
  type UpsertOptions,
  upsertOffer,
} from './books.js';
import { createListener, deleteListener, type ListenerInput } from './listeners.js';
import { createTestPool, truncateAll } from './testPool.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

const now = new Date('2026-10-29T12:00:00Z');
const later = new Date('2026-10-30T12:00:00Z');

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    source: 'bokus',
    title: 'I stundens hetta',
    authors: ['Viveca Sten'],
    isbn: '9789137138466',
    format: 'ebook',
    language: 'sv',
    price: 59,
    currency: 'SEK',
    url: 'https://www.bokus.com/bok/9789137138466/i-stundens-hetta/',
    coverUrl: null,
    ...overrides,
  };
}

const watchInRange: UpsertOptions = { inRange: true, notify: true, now };

const listenerInput: ListenerInput = {
  name: 'Viveca Sten',
  author: 'Viveca Sten',
  language: 'sv',
  format: 'ebook',
  minPriceEur: null,
  maxPriceEur: null,
  sources: ['adlibris', 'bokus'],
  enabled: true,
};

describe('upsertFromResult', () => {
  it('creates a book in range as an eligible suggestion, queued on a watch run', async () => {
    const { book, created, becameEligible } = await upsertFromResult(db, result(), watchInRange);

    expect(created).toBe(true);
    expect(becameEligible).toBe(true);
    expect(book).toMatchObject({
      dedupeKey: 'isbn:9789137138466',
      isbn: '9789137138466',
      status: 'new',
      firstSeenAt: now,
      eligibleAt: now,
      notifyPending: true,
    });
  });

  it('does not queue a book found during a seed', async () => {
    const { book, becameEligible } = await upsertFromResult(db, result(), {
      ...watchInRange,
      notify: false,
    });
    expect(becameEligible).toBe(true);
    expect(book).toMatchObject({ eligibleAt: now, notifyPending: false });
  });

  it('stores a book out of range without making it a suggestion', async () => {
    const { book, created, becameEligible } = await upsertFromResult(db, result(), {
      ...watchInRange,
      inRange: false,
    });
    expect(created).toBe(true);
    expect(becameEligible).toBe(false);
    expect(book).toMatchObject({ eligibleAt: null, notifyPending: false });
  });

  it('makes a known out-of-range book eligible and queued once its price drops into range', async () => {
    await upsertFromResult(db, result(), { ...watchInRange, inRange: false });

    const drop = await upsertFromResult(db, result(), { ...watchInRange, now: later });
    expect(drop).toMatchObject({ created: false, becameEligible: true });
    expect(drop.book).toMatchObject({ eligibleAt: later, notifyPending: true });

    const again = await upsertFromResult(db, result(), { ...watchInRange, now: later });
    expect(again.becameEligible).toBe(false);
  });

  it('does not queue a known eligible book again, even after it was notified', async () => {
    const { book } = await upsertFromResult(db, result(), watchInRange);
    await db.query('UPDATE books SET notify_pending = false, notified_at = now() WHERE id = $1', [
      book.id,
    ]);

    const seenAgain = await upsertFromResult(db, result(), { ...watchInRange, now: later });

    expect(seenAgain).toMatchObject({ created: false, becameEligible: false });
    expect(seenAgain.book).toMatchObject({ eligibleAt: now, notifyPending: false });
  });

  it('keeps the status and details of a known book, filling in only what was missing', async () => {
    const { book } = await upsertFromResult(db, result({ language: null }), watchInRange);
    await setStatus(db, [book.id], 'read');

    const { book: seenAgain } = await upsertFromResult(
      db,
      result({
        source: 'adlibris',
        title: 'I stundens hetta (e-bok)',
        coverUrl: 'https://example.com/cover.jpg',
      }),
      { ...watchInRange, now: later },
    );

    expect(seenAgain).toMatchObject({
      id: book.id,
      title: 'I stundens hetta',
      language: 'sv',
      coverUrl: 'https://example.com/cover.jpg',
      status: 'read',
      firstSeenAt: now,
    });
  });

  it('deduplicates a book without an ISBN by authors, title and format', async () => {
    const first = await upsertFromResult(db, result({ isbn: null }), watchInRange);
    const second = await upsertFromResult(
      db,
      result({ isbn: null, source: 'adlibris', title: 'I Stundens Hetta' }),
      watchInRange,
    );
    expect(second).toMatchObject({ created: false, book: { id: first.book.id, isbn: null } });
  });
});

describe('upsertOffer', () => {
  it('gives one book found on two sources two offers', async () => {
    const fromBokus = await upsertFromResult(db, result(), watchInRange);
    const fromAdlibris = await upsertFromResult(db, result({ source: 'adlibris' }), watchInRange);
    expect(fromAdlibris.book.id).toBe(fromBokus.book.id);
    const bookId = fromBokus.book.id;

    await upsertOffer(db, {
      bookId,
      source: 'bokus',
      url: 'https://www.bokus.com/bok/9789137138466/',
      price: 59,
      currency: 'SEK',
      priceEur: 5.13,
      now,
    });
    await upsertOffer(db, {
      bookId,
      source: 'adlibris',
      url: 'https://www.adlibris.com/fi/kirja/i-stundens-hetta-9789137138466',
      price: 6.9,
      currency: 'EUR',
      priceEur: 6.9,
      now,
    });

    const { rows } = await db.query('SELECT count(*)::int AS n FROM books');
    expect(rows[0]).toEqual({ n: 1 });
    await linkListenerBook(db, {
      listenerId: (await createListener(db, listenerInput)).id,
      bookId,
      foundDuringSeed: false,
      now,
    });
    const [listed] = await listBooks(db, { status: 'new' });
    expect(listed.offers).toEqual([
      expect.objectContaining({ source: 'adlibris', price: 6.9, priceEur: 6.9 }),
      expect.objectContaining({ source: 'bokus', price: 59, currency: 'SEK', priceEur: 5.13 }),
    ]);
  });

  it('updates the price and last seen time of an existing offer', async () => {
    const { book } = await upsertFromResult(db, result(), watchInRange);
    const offer = {
      bookId: book.id,
      source: 'bokus' as const,
      url: 'https://www.bokus.com/bok/9789137138466/',
      price: 59,
      currency: 'SEK',
      priceEur: 5.13,
      now,
    };
    await upsertOffer(db, offer);
    await upsertOffer(db, { ...offer, price: 49, priceEur: 4.26, now: later });

    const { rows } = await db.query(
      'SELECT price, price_eur, first_seen_at, last_seen_at FROM book_offers',
    );
    expect(rows).toEqual([{ price: 49, price_eur: 4.26, first_seen_at: now, last_seen_at: later }]);
  });
});

describe('linkListenerBook', () => {
  it('keeps the first link, so a seeded book stays found during the seed', async () => {
    const { id: listenerId } = await createListener(db, listenerInput);
    const { book } = await upsertFromResult(db, result(), { ...watchInRange, notify: false });

    await linkListenerBook(db, { listenerId, bookId: book.id, foundDuringSeed: true, now });
    await linkListenerBook(db, { listenerId, bookId: book.id, foundDuringSeed: false, now: later });

    const { rows } = await db.query('SELECT found_during_seed, first_seen_at FROM listener_books');
    expect(rows).toEqual([{ found_during_seed: true, first_seen_at: now }]);
  });
});

describe('setStatus', () => {
  it('moves several books in one call and stamps the change', async () => {
    const a = await upsertFromResult(db, result(), watchInRange);
    const b = await upsertFromResult(db, result({ isbn: '9789137138467' }), watchInRange);

    expect(await setStatus(db, [a.book.id, b.book.id], 'accepted')).toBe(2);

    const { rows } = await db.query<{ status: string; changed: boolean }>(
      "SELECT status, status_changed_at > now() - interval '1 minute' AS changed FROM books",
    );
    expect(rows).toEqual([
      { status: 'accepted', changed: true },
      { status: 'accepted', changed: true },
    ]);
  });

  it('leaves books already in that status untouched', async () => {
    const { book } = await upsertFromResult(db, result(), watchInRange);
    expect(await setStatus(db, [book.id], 'new')).toBe(0);
    const { rows } = await db.query('SELECT status_changed_at FROM books');
    expect(rows).toEqual([{ status_changed_at: null }]);
  });

  it('lets a book move from any status to any other', async () => {
    const { book } = await upsertFromResult(db, result(), watchInRange);
    await setStatus(db, [book.id], 'rejected');
    expect(await setStatus(db, [book.id], 'new')).toBe(1);
  });
});

describe('listBooks', () => {
  it('lists suggestions newest first, leaving out books never seen in range', async () => {
    const older = await upsertFromResult(db, result({ isbn: '9789137138461' }), watchInRange);
    const newer = await upsertFromResult(db, result({ isbn: '9789137138462' }), {
      ...watchInRange,
      now: later,
    });
    await upsertFromResult(db, result({ isbn: '9789137138463' }), {
      ...watchInRange,
      inRange: false,
    });

    const ids = (await listBooks(db, { status: 'new' })).map((book) => book.id);

    expect(ids).toEqual([newer.book.id, older.book.id]);
  });

  it('lists the books in another status, with the listeners that found them', async () => {
    const listener = await createListener(db, listenerInput);
    const { book } = await upsertFromResult(db, result(), watchInRange);
    await linkListenerBook(db, {
      listenerId: listener.id,
      bookId: book.id,
      foundDuringSeed: true,
      now,
    });
    await setStatus(db, [book.id], 'accepted');

    expect(await listBooks(db, { status: 'new' })).toEqual([]);
    const [accepted] = await listBooks(db, { status: 'accepted' });
    expect(accepted).toMatchObject({
      id: book.id,
      status: 'accepted',
      offers: [],
      listeners: [{ id: listener.id, name: 'Viveca Sten' }],
    });
  });

  it('filters by listener', async () => {
    const sten = await createListener(db, listenerInput);
    const lindgren = await createListener(db, {
      ...listenerInput,
      name: 'Astrid Lindgren',
      author: 'Astrid Lindgren',
    });
    const stenBook = await upsertFromResult(db, result(), watchInRange);
    const lindgrenBook = await upsertFromResult(
      db,
      result({ isbn: '9789129688313', title: 'Mio, min Mio', authors: ['Astrid Lindgren'] }),
      watchInRange,
    );
    await linkListenerBook(db, {
      listenerId: sten.id,
      bookId: stenBook.book.id,
      foundDuringSeed: false,
      now,
    });
    await linkListenerBook(db, {
      listenerId: lindgren.id,
      bookId: lindgrenBook.book.id,
      foundDuringSeed: false,
      now,
    });

    const ids = (await listBooks(db, { status: 'new', listenerId: lindgren.id })).map(
      (book) => book.id,
    );

    expect(ids).toEqual([lindgrenBook.book.id]);
  });

  it('keeps a deleted listener’s books and their status', async () => {
    const listener = await createListener(db, listenerInput);
    const { book } = await upsertFromResult(db, result(), watchInRange);
    await linkListenerBook(db, {
      listenerId: listener.id,
      bookId: book.id,
      foundDuringSeed: true,
      now,
    });
    await setStatus(db, [book.id], 'read');

    await deleteListener(db, listener.id);

    const [read] = await listBooks(db, { status: 'read' });
    expect(read).toMatchObject({ id: book.id, listeners: [] });
  });
});
