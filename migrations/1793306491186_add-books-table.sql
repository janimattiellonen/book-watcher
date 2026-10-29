-- Up Migration

-- One row per unique book, however many sources list it. Spec US-3 and US-4.
CREATE TABLE books (
  id                bigserial   NOT NULL,
  -- 'isbn:<isbn13>', or 'ta:<author>|<title>|<format>' when a result has no ISBN.
  -- This is what makes a book found on both stores a single row.
  dedupe_key        text        NOT NULL,
  isbn              text,
  title             text        NOT NULL,
  authors           text[]      NOT NULL,
  language          text,
  format            text        NOT NULL,
  cover_url         text,
  published_date    date,
  status            text        NOT NULL DEFAULT 'new',
  status_changed_at timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  -- First time the book was within a listener's price range. NULL while it is only
  -- known at a price outside every range.
  eligible_at       timestamptz,
  -- Queued for the next daily digest. Never set for books found during a seed.
  notify_pending    boolean     NOT NULL DEFAULT false,
  notified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT books_pkey PRIMARY KEY (id),
  CONSTRAINT uq_books_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT ck_books_status CHECK (status IN ('new', 'accepted', 'read', 'rejected'))
);

CREATE INDEX ix_books_status ON books (status);

-- The digest reads only the queued books, which are a handful among thousands.
CREATE INDEX ix_books_notify_pending ON books (id) WHERE notify_pending;

CREATE TRIGGER trg_books_set_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE books;
