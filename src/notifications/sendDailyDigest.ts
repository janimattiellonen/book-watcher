import { listBooks, markNotified } from '../db/books.js';
import { getDigestDay, type NotificationStatus, recordNotification } from '../db/notifications.js';
import type { Db } from '../db/pool.js';
import { buildDigest } from './digest.js';
import { isDigestDue, localDate } from './digestPolicy.js';
import type { SendEmail } from './mailer.js';

export interface DigestResult {
  status: NotificationStatus;
  bookIds: number[];
  error: string | null;
  /** False when the day already had a completed digest, so this one was not recorded. */
  recorded: boolean;
}

/**
 * Sends one digest of every queued suggestion (spec US-5). With nothing queued it
 * records `empty` and sends nothing. After a successful send it records the digest and
 * takes the books off the queue in one transaction; a failed send is recorded and the
 * books stay queued for the retry.
 */
export async function sendDailyDigest(db: Db, send: SendEmail, now: Date): Promise<DigestResult> {
  const digestDate = localDate(now);
  const books = await listBooks(db, { status: 'new', queued: true });
  const bookIds = books.map((book) => book.id);

  if (books.length === 0) {
    const recorded = await recordNotification(db, {
      digestDate,
      bookIds,
      status: 'empty',
      error: null,
      now,
    });
    return { status: 'empty', bookIds, error: null, recorded };
  }

  let status: 'sent' | 'mocked';
  try {
    status = await send(buildDigest(books));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordNotification(db, { digestDate, bookIds, status: 'failed', error: message, now });
    return { status: 'failed', bookIds, error: message, recorded: true };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const recorded = await recordNotification(client, {
      digestDate,
      bookIds,
      status,
      error: null,
      now,
    });
    await markNotified(client, bookIds, now);
    await client.query('COMMIT');
    return { status, bookIds, error: null, recorded };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type DigestOutcome = { status: 'disabled' | 'not-due' } | DigestResult;

export interface RunDigestInput {
  db: Db;
  send: SendEmail;
  now: Date;
  enabled: boolean;
  /** 'HH:MM', local time. */
  digestTime: string;
  /** Skip the once-a-day rule (`npm run digest -- --force`). Never skips `enabled`. */
  force?: boolean;
}

/**
 * The digest step of the scheduler and the `digest` script: nothing at all while
 * notifications are off, otherwise a digest when one is due, or when forced.
 */
export async function runDailyDigest({
  db,
  send,
  now,
  enabled,
  digestTime,
  force = false,
}: RunDigestInput): Promise<DigestOutcome> {
  if (!enabled) return { status: 'disabled' };
  if (!force) {
    const day = await getDigestDay(db, localDate(now));
    const due = isDigestDue({
      now,
      digestTime,
      completedToday: day.completed,
      lastFailedAt: day.lastFailedAt,
    });
    if (!due) return { status: 'not-due' };
  }
  return sendDailyDigest(db, send, now);
}
