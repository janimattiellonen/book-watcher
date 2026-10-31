-- Up Migration

-- One row per series, per author. Series spec, decision 3.
CREATE TABLE series (
  id         bigserial   NOT NULL,
  -- The first name seen, as the store wrote it.
  name       text        NOT NULL,
  -- Case-folded, without a trailing "-serien" or "-sarja", so both stores' names meet.
  name_key   text        NOT NULL,
  -- The first author of the book that created the series, as the store wrote it.
  author     text        NOT NULL,
  author_key text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT series_pkey PRIMARY KEY (id),
  -- The author keeps two authors' series of the same name apart.
  CONSTRAINT uq_series_author_name UNIQUE (author_key, name_key)
);

CREATE TRIGGER trg_series_set_updated_at
  BEFORE UPDATE ON series
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE books
  ADD COLUMN series_id         bigint,
  -- numeric, so a "Del 2.5" fits.
  ADD COLUMN series_part       numeric(6,2),
  -- Which store the series came from; a Bokus value replaces an Adlibris one (decision 4).
  ADD COLUMN series_source     text,
  -- When an Adlibris book page was last read successfully, with or without a series.
  -- Set once; a book with it is never looked up again (US-S2).
  ADD COLUMN series_checked_at timestamptz,
  -- No ON DELETE action: a series still in use can't be deleted. Nothing deletes series,
  -- and SET NULL would break ck_books_series_consistent anyway.
  ADD CONSTRAINT fk_books_series FOREIGN KEY (series_id) REFERENCES series (id),
  ADD CONSTRAINT ck_books_series_source CHECK (series_source IN ('adlibris', 'bokus')),
  -- A series always has a source, and a part only exists within a series.
  ADD CONSTRAINT ck_books_series_consistent
    CHECK ((series_id IS NULL) = (series_source IS NULL)
           AND (series_part IS NULL OR series_id IS NOT NULL));

CREATE INDEX ix_books_series_id ON books (series_id);

-- Adlibris book-page lookups are logged as runs of their own (US-S2).
ALTER TABLE runs
  DROP CONSTRAINT ck_runs_kind,
  ADD CONSTRAINT ck_runs_kind CHECK (kind IN ('seed', 'watch', 'series'));

-- Down Migration
DELETE FROM runs WHERE kind = 'series';

ALTER TABLE runs
  DROP CONSTRAINT ck_runs_kind,
  ADD CONSTRAINT ck_runs_kind CHECK (kind IN ('seed', 'watch'));

DROP INDEX ix_books_series_id;

ALTER TABLE books
  DROP CONSTRAINT ck_books_series_consistent,
  DROP CONSTRAINT ck_books_series_source,
  DROP CONSTRAINT fk_books_series,
  DROP COLUMN series_checked_at,
  DROP COLUMN series_source,
  DROP COLUMN series_part,
  DROP COLUMN series_id;

DROP TABLE series;
