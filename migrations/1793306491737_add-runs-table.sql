-- Up Migration

-- One row per listener-source search. Spec US-6.
CREATE TABLE runs (
  id          bigserial   NOT NULL,
  -- Kept when the listener is deleted, so the run history survives.
  listener_id bigint,
  source      text        NOT NULL,
  kind        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'running',
  results     integer,
  new_books   integer,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT runs_pkey PRIMARY KEY (id),
  CONSTRAINT fk_runs_listener
    FOREIGN KEY (listener_id) REFERENCES listeners (id) ON DELETE SET NULL,
  CONSTRAINT ck_runs_source CHECK (source IN ('adlibris', 'bokus')),
  CONSTRAINT ck_runs_kind CHECK (kind IN ('seed', 'watch')),
  CONSTRAINT ck_runs_status CHECK (status IN ('running', 'ok', 'failed', 'suspicious')),
  CONSTRAINT ck_runs_results CHECK (results IS NULL OR results >= 0),
  CONSTRAINT ck_runs_new_books CHECK (new_books IS NULL OR new_books >= 0)
);

-- Latest runs per listener, and the suspicious-result guard's "had results before" check.
CREATE INDEX ix_runs_listener_started ON runs (listener_id, started_at DESC);

-- Down Migration
DROP TABLE runs;
