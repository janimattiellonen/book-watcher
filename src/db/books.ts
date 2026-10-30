import type { SearchResult, SourceId } from '../sources/types.js';
import { dedupeKey, normalizeIsbn } from '../watcher/matching.js';
import type { Queryable } from './pool.js';

export const BOOK_STATUSES = ['new', 'accepted', 'read', 'rejected'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

export interface Book {
  id: number;
  dedupeKey: string;
  isbn: string | null;
  title: string;
  authors: string[];
  language: string | null;
  format: string;
  coverUrl: string | null;
  /** 'YYYY-MM-DD'. */
  publishedDate: string | null;
  status: BookStatus;
  statusChangedAt: Date | null;
  firstSeenAt: Date;
  eligibleAt: Date | null;
  notifyPending: boolean;
  notifiedAt: Date | null;
}

interface BookRow {
  id: number;
  dedupe_key: string;
  isbn: string | null;
  title: string;
  authors: string[];
  language: string | null;
  format: string;
  cover_url: string | null;
  published_date: string | null;
  status: BookStatus;
  status_changed_at: Date | null;
  first_seen_at: Date;
  eligible_at: Date | null;
  notify_pending: boolean;
  notified_at: Date | null;
}

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    isbn: row.isbn,
    title: row.title,
    authors: row.authors,
    language: row.language,
    format: row.format,
    coverUrl: row.cover_url,
    publishedDate: row.published_date,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    firstSeenAt: row.first_seen_at,
    eligibleAt: row.eligible_at,
    notifyPending: row.notify_pending,
    notifiedAt: row.notified_at,
  };
}

export interface UpsertOptions {
  /** Whether the result is within the price range of the listener that found it. */
  inRange: boolean;
  /** Queue the book for the digest if this upsert makes it eligible. False during a seed. */
  notify: boolean;
  now: Date;
}

export interface UpsertResult {
  book: Book;
  /** The book was not in the database before. */
  created: boolean;
  /**
   * This upsert made the book a suggestion: it is new and in range, or it was known
   * only at out-of-range prices and is now in range. Happens at most once per book.
   */
  becameEligible: boolean;
}

/**
 * Records a search result as a book, deduplicated by ISBN (or authors, title and
 * format). A known book keeps its status and details; only a missing cover or language
 * is filled in. A book becomes eligible once, the first time it is seen in range, and
 * with `notify` that is also when it is queued for the digest.
 */
export async function upsertFromResult(
  db: Queryable,
  result: SearchResult,
  { inRange, notify, now }: UpsertOptions,
): Promise<UpsertResult> {
  // All parts of one statement see the same snapshot, so `previous` is the row as it
  // was before the upsert. Runs are serialized by the scraping lock, so no concurrent
  // upsert can slip in between.
  const { rows } = await db.query<BookRow & { created: boolean; became_eligible: boolean }>(
    `WITH previous AS (
       SELECT eligible_at FROM books WHERE dedupe_key = $1
     ),
     upserted AS (
       INSERT INTO books
         (dedupe_key, isbn, title, authors, language, format, cover_url,
          first_seen_at, eligible_at, notify_pending)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               CASE WHEN $9::boolean THEN $8::timestamptz END,
               $9::boolean AND $10::boolean)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         cover_url      = COALESCE(books.cover_url, EXCLUDED.cover_url),
         language       = COALESCE(books.language, EXCLUDED.language),
         eligible_at    = COALESCE(books.eligible_at, EXCLUDED.eligible_at),
         notify_pending = books.notify_pending
                          OR (books.eligible_at IS NULL AND books.status = 'new'
                              AND EXCLUDED.notify_pending)
       RETURNING *, (xmax = 0) AS created
     )
     SELECT upserted.*,
            upserted.eligible_at IS NOT NULL
              AND (SELECT eligible_at FROM previous) IS NULL AS became_eligible
     FROM upserted`,
    [
      dedupeKey(result),
      normalizeIsbn(result.isbn),
      result.title,
      result.authors,
      result.language,
      result.format,
      result.coverUrl,
      now,
      inRange,
      notify,
    ],
  );
  const row = rows[0];
  return { book: toBook(row), created: row.created, becameEligible: row.became_eligible };
}

/**
 * Sets the status of one or many books in a single statement. Books already in that
 * status are left alone, so `status_changed_at` records a real change. Returns how many
 * books changed.
 */
export async function setStatus(
  db: Queryable,
  bookIds: readonly number[],
  status: BookStatus,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE books SET status = $2, status_changed_at = now(),
       notify_pending = notify_pending AND $2 = 'new'
     WHERE id = ANY($1::bigint[]) AND status <> $2`,
    [bookIds, status],
  );
  return rowCount ?? 0;
}

export interface Offer {
  source: SourceId;
  url: string;
  price: number | null;
  currency: string | null;
  priceEur: number | null;
}

export interface BookListItem extends Book {
  /** Ordered by source. */
  offers: Offer[];
  /** The listeners that found the book, ordered by name. */
  listeners: { id: number; name: string }[];
}

/** A book row `b` with its offers and listeners, as `BookListItem` expects them. */
const BOOK_LIST_COLUMNS = `b.*,
  COALESCE((
    SELECT json_agg(json_build_object(
             'source', o.source, 'url', o.url, 'price', o.price,
             'currency', o.currency, 'priceEur', o.price_eur
           ) ORDER BY o.source)
    FROM book_offers o WHERE o.book_id = b.id
  ), '[]') AS offers,
  COALESCE((
    SELECT json_agg(json_build_object('id', l.id, 'name', l.name) ORDER BY lower(l.name), l.id)
    FROM listener_books lb JOIN listeners l ON l.id = lb.listener_id
    WHERE lb.book_id = b.id
  ), '[]') AS listeners`;

type BookListRow = BookRow & { offers: Offer[]; listeners: { id: number; name: string }[] };

export interface BookListFilter {
  status: BookStatus;
  listenerId?: number;
  /** Only books queued for the digest. */
  queued?: boolean;
}

/**
 * The books in one status, optionally only those one listener found. Suggestions
 * (`new`) leave out books never seen in range and are ordered by when they became
 * suggestions; the other views by when the book was last moved, newest first.
 */
export async function listBooks(
  db: Queryable,
  { status, listenerId, queued = false }: BookListFilter,
): Promise<BookListItem[]> {
  const { rows } = await db.query<BookListRow>(
    `SELECT ${BOOK_LIST_COLUMNS}
     FROM books b
     WHERE b.status = $1
       AND ($1 <> 'new' OR b.eligible_at IS NOT NULL)
       AND ($2::bigint IS NULL OR EXISTS (
         SELECT 1 FROM listener_books lb WHERE lb.book_id = b.id AND lb.listener_id = $2
       ))
       AND (NOT $3::boolean OR b.notify_pending)
     ORDER BY CASE WHEN $1 = 'new' THEN b.eligible_at ELSE b.status_changed_at END DESC NULLS LAST,
              b.id DESC`,
    [status, listenerId ?? null, queued],
  );
  return rows.map((row) => ({ ...toBook(row), offers: row.offers, listeners: row.listeners }));
}

export interface ListenerBook extends BookListItem {
  /** The listener found it during its seed, so it is no news to the user. */
  foundDuringSeed: boolean;
}

/**
 * Every book one listener found, in any status and in range or not, the most recently
 * found first.
 */
export async function listListenerBooks(
  db: Queryable,
  listenerId: number,
): Promise<ListenerBook[]> {
  const { rows } = await db.query<BookListRow & { found_during_seed: boolean }>(
    `SELECT ${BOOK_LIST_COLUMNS}, link.found_during_seed
     FROM listener_books link JOIN books b ON b.id = link.book_id
     WHERE link.listener_id = $1
     ORDER BY link.first_seen_at DESC, b.id DESC`,
    [listenerId],
  );
  return rows.map((row) => ({
    ...toBook(row),
    offers: row.offers,
    listeners: row.listeners,
    foundDuringSeed: row.found_during_seed,
  }));
}

/** Takes books off the digest queue once a digest containing them went out. */
export async function markNotified(
  db: Queryable,
  bookIds: readonly number[],
  now: Date,
): Promise<void> {
  await db.query(
    `UPDATE books SET notify_pending = false, notified_at = $2
     WHERE id = ANY($1::bigint[])`,
    [bookIds, now],
  );
}

export interface OfferInput {
  bookId: number;
  source: SourceId;
  url: string;
  price: number | null;
  currency: string | null;
  priceEur: number | null;
  now: Date;
}

/** One offer per book and source, updated in place with the latest URL and price. */
export async function upsertOffer(db: Queryable, offer: OfferInput): Promise<void> {
  await db.query(
    `INSERT INTO book_offers
       (book_id, source, url, price, currency, price_eur, first_seen_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (book_id, source) DO UPDATE SET
       url = EXCLUDED.url,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       price_eur = EXCLUDED.price_eur,
       last_seen_at = EXCLUDED.last_seen_at`,
    [offer.bookId, offer.source, offer.url, offer.price, offer.currency, offer.priceEur, offer.now],
  );
}

/**
 * Records that a listener found a book. The first link wins, so a book first found
 * during the seed stays `found_during_seed` when later watch runs see it again.
 */
export async function linkListenerBook(
  db: Queryable,
  link: { listenerId: number; bookId: number; foundDuringSeed: boolean; now: Date },
): Promise<void> {
  await db.query(
    `INSERT INTO listener_books (listener_id, book_id, found_during_seed, first_seen_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (listener_id, book_id) DO NOTHING`,
    [link.listenerId, link.bookId, link.foundDuringSeed, link.now],
  );
}
