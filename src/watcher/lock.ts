import type { Db } from '../db/pool.js';

/** Arbitrary, fixed key for the one lock every listener run takes. */
export const SCRAPING_LOCK_KEY = 4_270_331;

export interface HeldLock {
  release(): Promise<void>;
}

/**
 * Takes the scraping lock without waiting, so the scheduler and manual runs never
 * search the stores at the same time. Returns null when someone else holds it.
 *
 * A Postgres advisory lock belongs to a session, so the lock keeps its own connection
 * until released; if the process dies, Postgres drops the connection and the lock.
 */
export async function tryAcquireScrapingLock(db: Db): Promise<HeldLock | null> {
  const client = await db.connect();
  // The pool's error listener covers idle clients only. Without this one, losing the
  // connection while the lock is held would be an uncaught exception. The lock is gone
  // with the connection, and `release` then fails and discards the client.
  const onError = (error: Error) => console.error('Scraping lock: connection lost', error);
  client.on('error', onError);
  const done = (error?: Error | boolean) => {
    client.off('error', onError);
    client.release(error);
  };
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [SCRAPING_LOCK_KEY],
    );
    if (!rows[0].locked) {
      done();
      return null;
    }
  } catch (error) {
    done(true);
    throw error;
  }

  return {
    async release() {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [SCRAPING_LOCK_KEY]);
        done();
      } catch (error) {
        // Discard the connection rather than return it to the pool still holding the lock.
        done(true);
        throw error;
      }
    },
  };
}
