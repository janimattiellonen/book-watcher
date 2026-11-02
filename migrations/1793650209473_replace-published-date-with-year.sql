-- Up Migration

-- The stores show a year, not a date, so books keep only the year. published_date was
-- never filled in. Publication year spec.
ALTER TABLE books
  DROP COLUMN published_date,
  ADD COLUMN published_year smallint,
  ADD CONSTRAINT ck_books_published_year
    CHECK (published_year BETWEEN 1400 AND 2200);

-- Down Migration

ALTER TABLE books
  DROP CONSTRAINT ck_books_published_year,
  DROP COLUMN published_year,
  ADD COLUMN published_date date;
