-- Up Migration

-- Daily digest attempts. Spec US-5.
CREATE TABLE notifications (
  id          bigserial   NOT NULL,
  -- The local day the digest belongs to.
  digest_date date        NOT NULL,
  book_ids    bigint[]    NOT NULL DEFAULT '{}',
  -- 'empty' means the digest ran and found nothing queued, so nothing was sent.
  status      text        NOT NULL,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT ck_notifications_status CHECK (status IN ('sent', 'mocked', 'empty', 'failed'))
);

-- At most one completed digest per day. Failed attempts may repeat, since they are
-- retried every 30 minutes.
CREATE UNIQUE INDEX uq_notifications_completed_per_day
  ON notifications (digest_date) WHERE status IN ('sent', 'mocked', 'empty');

-- Down Migration
DROP TABLE notifications;
