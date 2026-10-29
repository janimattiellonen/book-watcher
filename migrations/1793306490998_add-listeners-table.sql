-- Up Migration

-- What to watch: one author with the requirements to apply, searched on one or more
-- sources. Spec US-1, US-2 and US-6.
CREATE TABLE listeners (
  id            bigserial     NOT NULL,
  name          text          NOT NULL,
  -- Both the search query and the name matched against each result's author list.
  author        text          NOT NULL,
  -- Normalized code ('fi', 'sv', 'en', ...); each source adapter maps it to its own facet.
  language      text          NOT NULL,
  format        text          NOT NULL DEFAULT 'ebook',
  -- In EUR; either bound may be open.
  min_price_eur numeric(10,2),
  max_price_eur numeric(10,2),
  sources       text[]        NOT NULL,
  enabled       boolean       NOT NULL DEFAULT true,
  -- 'pending' until a seed has succeeded on every source; only then 'active'.
  seed_state    text          NOT NULL DEFAULT 'pending',
  seeded_at     timestamptz,
  -- End of the last run, whatever its outcome. Drives the once-a-day limit, so a
  -- failed run counts too and a store that is blocking us is not retried early.
  last_run_at   timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT listeners_pkey PRIMARY KEY (id),
  CONSTRAINT ck_listeners_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_listeners_author_not_blank CHECK (btrim(author) <> ''),
  CONSTRAINT ck_listeners_min_price CHECK (min_price_eur IS NULL OR min_price_eur >= 0),
  CONSTRAINT ck_listeners_max_price CHECK (max_price_eur IS NULL OR max_price_eur >= 0),
  CONSTRAINT ck_listeners_price_range CHECK (
    min_price_eur IS NULL OR max_price_eur IS NULL OR min_price_eur <= max_price_eur
  ),
  CONSTRAINT ck_listeners_sources CHECK (
    cardinality(sources) > 0 AND sources <@ ARRAY['adlibris', 'bokus']::text[]
  ),
  CONSTRAINT ck_listeners_seed_state CHECK (seed_state IN ('pending', 'active'))
);

CREATE TRIGGER trg_listeners_set_updated_at
  BEFORE UPDATE ON listeners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE listeners;
