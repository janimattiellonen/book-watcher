import type { Queryable } from './pool.js';

export type NotificationStatus = 'sent' | 'mocked' | 'empty' | 'failed';

export interface NotificationInput {
  /** The local day the digest belongs to, 'YYYY-MM-DD'. */
  digestDate: string;
  bookIds: readonly number[];
  status: NotificationStatus;
  error: string | null;
  now: Date;
}

/** Records one digest attempt. */
export async function recordNotification(
  db: Queryable,
  notification: NotificationInput,
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (digest_date, book_ids, status, error, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      notification.digestDate,
      notification.bookIds,
      notification.status,
      notification.error,
      notification.now,
    ],
  );
}

export interface DigestDay {
  /** A digest was sent, mocked or found empty that day, so none is due again. */
  completed: boolean;
  /** The latest failed attempt that day, if any; retries wait 30 minutes from it. */
  lastFailedAt: Date | null;
}

/** What the digest policy needs to know about one day's attempts. */
export async function getDigestDay(db: Queryable, digestDate: string): Promise<DigestDay> {
  const { rows } = await db.query<{ completed: boolean; last_failed_at: Date | null }>(
    `SELECT bool_or(status <> 'failed') IS TRUE AS completed,
            max(created_at) FILTER (WHERE status = 'failed') AS last_failed_at
     FROM notifications
     WHERE digest_date = $1`,
    [digestDate],
  );
  return { completed: rows[0].completed, lastFailedAt: rows[0].last_failed_at };
}
