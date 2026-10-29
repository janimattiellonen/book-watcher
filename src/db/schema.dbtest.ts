import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestPool } from './testPool.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(async () => {
  await db.query(
    'TRUNCATE listeners, books, book_offers, listener_books, runs, notifications RESTART IDENTITY CASCADE',
  );
});

async function insertListener(overrides: Record<string, unknown> = {}): Promise<number> {
  const values = {
    name: 'Viveca Sten',
    author: 'Viveca Sten',
    language: 'sv',
    min_price_eur: null,
    max_price_eur: null,
    sources: ['bokus'],
    ...overrides,
  };
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO listeners (name, author, language, min_price_eur, max_price_eur, sources)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      values.name,
      values.author,
      values.language,
      values.min_price_eur,
      values.max_price_eur,
      values.sources,
    ],
  );
  return rows[0].id;
}

async function insertBook(dedupeKey = 'isbn:9789137138466'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO books (dedupe_key, isbn, title, authors, format)
     VALUES ($1, '9789137138466', 'I stundens hetta', ARRAY['Viveca Sten'], 'ebook') RETURNING id`,
    [dedupeKey],
  );
  return rows[0].id;
}

describe('listeners', () => {
  it('starts a new listener as pending and enabled', async () => {
    const id = await insertListener();
    const { rows } = await db.query(
      'SELECT seed_state, enabled, format FROM listeners WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ seed_state: 'pending', enabled: true, format: 'ebook' });
  });

  it('rejects a minimum price above the maximum', async () => {
    await expect(insertListener({ min_price_eur: 10, max_price_eur: 5 })).rejects.toThrow(
      /ck_listeners_price_range/,
    );
  });

  it('accepts an open-ended price range', async () => {
    await expect(insertListener({ min_price_eur: 5, max_price_eur: null })).resolves.toBeTypeOf(
      'number',
    );
  });

  it('rejects a negative price', async () => {
    await expect(insertListener({ max_price_eur: -1 })).rejects.toThrow(/ck_listeners_max_price/);
  });

  it('rejects an empty source list and an unknown source', async () => {
    await expect(insertListener({ sources: [] })).rejects.toThrow(/ck_listeners_sources/);
    await expect(insertListener({ sources: ['amazon'] })).rejects.toThrow(/ck_listeners_sources/);
  });

  it('rejects a blank author', async () => {
    await expect(insertListener({ author: '  ' })).rejects.toThrow(/ck_listeners_author_not_blank/);
  });

  it('maintains updated_at on update', async () => {
    const id = await insertListener();
    await db.query("UPDATE listeners SET updated_at = now() - interval '1 day' WHERE id = $1", [
      id,
    ]);
    await db.query('UPDATE listeners SET enabled = false WHERE id = $1', [id]);
    const { rows } = await db.query<{ fresh: boolean }>(
      "SELECT updated_at > now() - interval '1 minute' AS fresh FROM listeners WHERE id = $1",
      [id],
    );
    expect(rows[0].fresh).toBe(true);
  });
});

describe('books', () => {
  it('rejects an unknown status', async () => {
    const id = await insertBook();
    await expect(db.query("UPDATE books SET status = 'maybe' WHERE id = $1", [id])).rejects.toThrow(
      /ck_books_status/,
    );
  });

  it('rejects a second book with the same dedupe key', async () => {
    await insertBook();
    await expect(insertBook()).rejects.toThrow(/uq_books_dedupe_key/);
  });

  it('allows one offer per source', async () => {
    const id = await insertBook();
    const insertOffer = (source: string) =>
      db.query(`INSERT INTO book_offers (book_id, source, url) VALUES ($1, $2, 'https://x')`, [
        id,
        source,
      ]);
    await insertOffer('bokus');
    await insertOffer('adlibris');
    await expect(insertOffer('bokus')).rejects.toThrow(/uq_book_offers_book_source/);
  });

  it('keeps books and run history when their listener is deleted', async () => {
    const listenerId = await insertListener();
    const bookId = await insertBook();
    await db.query(
      'INSERT INTO listener_books (listener_id, book_id, found_during_seed) VALUES ($1, $2, true)',
      [listenerId, bookId],
    );
    await db.query("INSERT INTO runs (listener_id, source, kind) VALUES ($1, 'bokus', 'seed')", [
      listenerId,
    ]);

    await db.query('DELETE FROM listeners WHERE id = $1', [listenerId]);

    const counts = await db.query<{ books: number; links: number; runs: number }>(
      `SELECT (SELECT count(*) FROM books) AS books,
              (SELECT count(*) FROM listener_books) AS links,
              (SELECT count(*) FROM runs WHERE listener_id IS NULL) AS runs`,
    );
    expect(counts.rows[0]).toEqual({ books: 1, links: 0, runs: 1 });
  });
});

describe('notifications', () => {
  const insertDigest = (status: string) =>
    db.query("INSERT INTO notifications (digest_date, status) VALUES ('2026-10-30', $1)", [status]);

  it('allows only one completed digest per day', async () => {
    await insertDigest('sent');
    await expect(insertDigest('empty')).rejects.toThrow(/uq_notifications_completed_per_day/);
  });

  it('allows repeated failed attempts before the day completes', async () => {
    await insertDigest('failed');
    await insertDigest('failed');
    await expect(insertDigest('sent')).resolves.toBeDefined();
  });
});
