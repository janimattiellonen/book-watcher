import { type SeriesRef, seriesAuthorKey, seriesNameKey } from '../sources/series.js';
import type { SourceId } from '../sources/types.js';
import type { BookStatus } from './books.js';
import type { Queryable } from './pool.js';

export interface Series {
  id: number;
  /** As the store first wrote it. */
  name: string;
  /** The first author of the book that created the series, as the store wrote it. */
  author: string;
  authorKey: string;
}

interface SeriesRow {
  id: number;
  name: string;
  author: string;
  author_key: string;
}

const toSeries = (row: SeriesRow): Series => ({
  id: row.id,
  name: row.name,
  author: row.author,
  authorKey: row.author_key,
});

/**
 * Gives a book its series and part (series spec, decision 4). A series from Bokus
 * always applies, replacing one from Adlibris; one from Adlibris applies only to a book
 * without a series. The series itself is found or created by its author (the book's
 * first author) and normalized name. Returns whether the book's series was set or
 * changed; a book without authors can't be placed in a series and is left alone.
 */
export async function applyBookSeries(
  db: Queryable,
  {
    bookId,
    authors,
    series,
    source,
  }: {
    bookId: number;
    authors: readonly string[];
    series: SeriesRef;
    source: SourceId;
  },
): Promise<boolean> {
  const authorKey = seriesAuthorKey(authors);
  if (!authorKey) return false;
  const author = authors.find((name) => name.trim()) ?? '';

  // DO UPDATE instead of DO NOTHING, so RETURNING gives the id of an existing series too.
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO series (name, name_key, author, author_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (author_key, name_key) DO UPDATE SET name = series.name
     RETURNING id`,
    [series.name, seriesNameKey(series.name), author, authorKey],
  );

  const { rowCount } = await db.query(
    `UPDATE books SET series_id = $2, series_part = $3, series_source = $4
     WHERE id = $1
       AND ($4 = 'bokus' OR series_id IS NULL)
       AND (series_id, series_part, series_source) IS DISTINCT FROM ($2, $3::numeric, $4)`,
    [bookId, rows[0].id, series.part, source],
  );
  return (rowCount ?? 0) > 0;
}

/** A book waiting for its Adlibris book page to be read. */
export interface LookupCandidate {
  bookId: number;
  isbn: string | null;
  authors: string[];
  /** The book's Adlibris offer URL, which is its book page. */
  url: string;
}

/**
 * The listener's books still waiting for a series lookup (US-S2): they have an Adlibris
 * offer, no series and no successful lookup. The ones the listener found last come
 * first, so new books get their series soonest.
 */
export async function listLookupQueue(
  db: Queryable,
  listenerId: number,
  limit: number,
): Promise<LookupCandidate[]> {
  const { rows } = await db.query<LookupCandidate>(
    `SELECT b.id AS "bookId", b.isbn, b.authors, o.url
     FROM listener_books link
     JOIN books b ON b.id = link.book_id
     JOIN book_offers o ON o.book_id = b.id AND o.source = 'adlibris'
     WHERE link.listener_id = $1 AND b.series_id IS NULL AND b.series_checked_at IS NULL
     ORDER BY link.first_seen_at DESC, b.id DESC
     LIMIT $2`,
    [listenerId, limit],
  );
  return rows;
}

/** Records a successful lookup, whether or not it found a series, so it isn't repeated. */
export async function markSeriesChecked(
  db: Queryable,
  bookId: number,
  now: Date,
  publishedYear: number | null = null,
): Promise<void> {
  // The book page's year fills in one the search results didn't give (published year spec).
  await db.query(
    `UPDATE books SET series_checked_at = $2, published_year = COALESCE(published_year, $3)
     WHERE id = $1`,
    [bookId, now, publishedYear],
  );
}

export interface SeriesSummary extends Series {
  /** How many of the series' books are in each status. */
  counts: Record<BookStatus, number>;
}

/** Every series that has at least one book, by name, with its books counted by status. */
export async function listSeries(db: Queryable): Promise<SeriesSummary[]> {
  const { rows } = await db.query<SeriesRow & Record<BookStatus, number>>(
    `SELECT s.id, s.name, s.author, s.author_key,
            count(*) FILTER (WHERE b.status = 'new')      AS new,
            count(*) FILTER (WHERE b.status = 'accepted') AS accepted,
            count(*) FILTER (WHERE b.status = 'read')     AS read,
            count(*) FILTER (WHERE b.status = 'rejected') AS rejected
     FROM series s JOIN books b ON b.series_id = s.id
     GROUP BY s.id
     ORDER BY lower(s.name), lower(s.author), s.id`,
  );
  return rows.map((row) => ({
    ...toSeries(row),
    counts: { new: row.new, accepted: row.accepted, read: row.read, rejected: row.rejected },
  }));
}

export async function getSeries(db: Queryable, id: number): Promise<Series | null> {
  const { rows } = await db.query<SeriesRow>(
    'SELECT id, name, author, author_key FROM series WHERE id = $1',
    [id],
  );
  return rows[0] ? toSeries(rows[0]) : null;
}

/**
 * How many books by this author are still waiting for a series lookup, for the series
 * page (US-S4): they may yet fill one of its gaps. The author is compared the way the
 * series key was made, which SQL can't do, so the waiting books are matched here. They
 * are at most the books found since the last lookups, a few hundred after a big seed.
 */
export async function countWaitingLookups(db: Queryable, authorKey: string): Promise<number> {
  const { rows } = await db.query<{ authors: string[] }>(
    `SELECT b.authors FROM books b
     WHERE b.series_id IS NULL AND b.series_checked_at IS NULL
       AND EXISTS (SELECT 1 FROM book_offers o WHERE o.book_id = b.id AND o.source = 'adlibris')`,
  );
  return rows.filter((row) => seriesAuthorKey(row.authors) === authorKey).length;
}
