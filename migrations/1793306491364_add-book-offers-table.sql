-- Up Migration

-- A book's listing on one source: one row per book and source, updated in place as
-- the price changes.
CREATE TABLE book_offers (
  id            bigserial     NOT NULL,
  book_id       bigint        NOT NULL,
  source        text          NOT NULL,
  url           text          NOT NULL,
  -- As the store shows it, in its own currency.
  price         numeric(10,2),
  currency      text,
  -- Converted for comparison with listener price ranges (SEK via SEK_TO_EUR).
  price_eur     numeric(10,2),
  first_seen_at timestamptz   NOT NULL DEFAULT now(),
  last_seen_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT book_offers_pkey PRIMARY KEY (id),
  CONSTRAINT fk_book_offers_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
  CONSTRAINT uq_book_offers_book_source UNIQUE (book_id, source),
  CONSTRAINT ck_book_offers_source CHECK (source IN ('adlibris', 'bokus')),
  CONSTRAINT ck_book_offers_price CHECK (price IS NULL OR price >= 0),
  CONSTRAINT ck_book_offers_price_eur CHECK (price_eur IS NULL OR price_eur >= 0)
);

-- Down Migration
DROP TABLE book_offers;
