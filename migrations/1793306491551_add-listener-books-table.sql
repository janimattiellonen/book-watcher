-- Up Migration

-- Which listener found which book. Deleting a listener removes these links but keeps
-- the books and their statuses (spec US-1).
CREATE TABLE listener_books (
  listener_id       bigint      NOT NULL,
  book_id           bigint      NOT NULL,
  found_during_seed boolean     NOT NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listener_books_pkey PRIMARY KEY (listener_id, book_id),
  CONSTRAINT fk_listener_books_listener
    FOREIGN KEY (listener_id) REFERENCES listeners (id) ON DELETE CASCADE,
  CONSTRAINT fk_listener_books_book
    FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

-- The primary key covers lookups by listener; this covers lookups by book.
CREATE INDEX ix_listener_books_book_id ON listener_books (book_id);

-- Down Migration
DROP TABLE listener_books;
