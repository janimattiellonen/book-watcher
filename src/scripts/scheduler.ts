/**
 * The long-running scheduler (spec US-6).
 *
 *   npm run scheduler
 *
 * Wakes once a minute: sends the daily digest when it is due, then starts at most one
 * listener run when the rate limits allow. Ctrl+C lets the run in progress finish;
 * a second Ctrl+C closes the browser so the run ends at once, still recorded as failed.
 */
import cron from 'node-cron';

import { loadConfig } from '../config.js';
import { listDue, listListeners } from '../db/listeners.js';
import { createPool } from '../db/pool.js';
import { lastFinishedAt } from '../db/runs.js';
import { createSendEmail } from '../notifications/mailer.js';
import { runDailyDigest } from '../notifications/sendDailyDigest.js';
import { withLiveSearch } from '../watcher/liveSearch.js';
import { tryAcquireScrapingLock } from '../watcher/lock.js';
import { runListener } from '../watcher/runListener.js';
import { createTicker } from '../watcher/tick.js';

const config = loadConfig();
const db = createPool();
const sendEmail = createSendEmail(config.email);
const abortRuns = new AbortController();

const log = (message: string) => console.log(`[${new Date().toLocaleString('sv-SE')}] ${message}`);

const ticker = createTicker({
  now: () => new Date(),
  log,
  config,
  digest: () =>
    runDailyDigest({
      db,
      send: sendEmail,
      now: new Date(),
      enabled: config.emailNotificationsEnabled,
      digestTime: config.digestTime,
    }),
  acquireLock: () => tryAcquireScrapingLock(db),
  loadSchedule: async () => ({
    listeners: await listListeners(db),
    lastRunEndedAt: await lastFinishedAt(db),
  }),
  run: (listener) =>
    withLiveSearch(
      {
        maxPagesPerSearch: config.maxPagesPerSearch,
        signal: abortRuns.signal,
        handleSignals: false,
      },
      (search, pause) =>
        runListener(
          { db, search, pause, now: () => new Date(), sekToEur: config.sekToEur, log },
          listener,
        ),
    ),
});

const due = await listDue(db, new Date(), config.listenerIntervalHours);
console.log('Book Watcher scheduler');
console.log(`  Each listener at most every ${config.listenerIntervalHours} h`);
console.log(
  `  Gap between runs: ${config.minGapMinutes} min + 0–${config.gapJitterMinutes} min jitter`,
);
console.log(`  Listeners due now: ${due.length}`);
console.log(
  `  E-mail digest: ${config.emailNotificationsEnabled ? `on, daily at ${config.digestTime}` : 'off'}` +
    (config.email.mockMode ? ' (mock mode)' : ''),
);
console.log('Press Ctrl+C to stop.\n');

const task = cron.schedule('* * * * *', () => ticker.tick());
void ticker.tick();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) {
    log(`${signal} again: closing the browser to end the current run now.`);
    abortRuns.abort();
    return;
  }
  stopping = true;
  log(`${signal}: stopping. Letting the current run finish; press Ctrl+C again to end it now.`);
  await task.stop();
  await ticker.stop();
  await db.end();
  log('Scheduler stopped.');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}
