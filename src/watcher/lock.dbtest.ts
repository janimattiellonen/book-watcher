import { afterAll, describe, expect, it } from 'vitest';

import { createTestPool } from '../db/testPool.js';
import { SCRAPING_LOCK_KEY, tryAcquireScrapingLock } from './lock.js';

// Two pools stand in for two processes: the scheduler and a manual run.
const scheduler = createTestPool();
const manual = createTestPool();

afterAll(() => Promise.all([scheduler.end(), manual.end()]));

describe('tryAcquireScrapingLock', () => {
  it('refuses a second holder until the first releases', async () => {
    const held = await tryAcquireScrapingLock(scheduler);
    expect(held).not.toBeNull();

    expect(await tryAcquireScrapingLock(manual)).toBeNull();

    await held?.release();
    const next = await tryAcquireScrapingLock(manual);
    expect(next).not.toBeNull();
    await next?.release();
  });

  it('is released when the holding connection goes away', async () => {
    const crashing = createTestPool();
    const lost = await tryAcquireScrapingLock(crashing);
    expect(lost).not.toBeNull();
    expect(await tryAcquireScrapingLock(manual)).toBeNull();

    // Kill the holder's backend, as Postgres does when a crashed process's socket closes.
    await manual.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
       WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND objid = $1`,
      [SCRAPING_LOCK_KEY],
    );

    const next = await tryAcquireScrapingLock(manual);
    expect(next).not.toBeNull();
    await next?.release();
    // Releasing a lock whose connection is gone fails, and the dead client is discarded.
    await expect(lost?.release()).rejects.toThrow();
    await crashing.end();
  });
});
