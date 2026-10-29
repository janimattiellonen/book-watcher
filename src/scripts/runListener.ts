/**
 * Runs one listener now: a seed if it is pending, otherwise a watch run.
 *
 *   npm run run-listener -- --listener <id> [--force]
 *
 * Follows the scheduler's rules: it refuses a listener that ran within the interval,
 * or a start before the gap after the previous run has passed. `--force` skips those
 * rules for debugging, but never the lock: it still refuses while another run is going.
 * Searches the live stores, so each run counts as real requests.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../config.js';
import { getListener } from '../db/listeners.js';
import { createPool } from '../db/pool.js';
import { lastFinishedAt } from '../db/runs.js';
import { withLiveSearch } from '../watcher/liveSearch.js';
import { tryAcquireScrapingLock } from '../watcher/lock.js';
import { runListener } from '../watcher/runListener.js';
import { pickNextListener } from '../watcher/schedulePolicy.js';

const { values } = parseArgs({
  options: {
    listener: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

if (!values.listener || !/^\d+$/.test(values.listener)) {
  console.error('Usage: run-listener --listener <id> [--force]');
  process.exit(1);
}

const config = loadConfig();
const db = createPool();

try {
  process.exitCode = await main(Number(values.listener), values.force);
} finally {
  await db.end();
}

async function main(id: number, force: boolean): Promise<number> {
  const listener = await getListener(db, id);
  if (!listener) {
    console.error(`No listener with id ${id}`);
    return 1;
  }

  const lock = await tryAcquireScrapingLock(db);
  if (!lock) {
    console.error(
      'Another run is in progress (the scheduler or another run-listener). Try again later.',
    );
    return 1;
  }

  try {
    if (!force) {
      const decision = pickNextListener({
        listeners: [listener],
        lastRunEndedAt: await lastFinishedAt(db),
        now: new Date(),
        config,
      });
      if (!decision.run) {
        console.error(`Not running: ${decision.reason}. Use --force to run anyway.`);
        return 1;
      }
    }

    console.log(
      `${listener.seedState === 'pending' ? 'Seeding' : 'Watching'} ${listener.name} on ${listener.sources.join(', ')}…`,
    );
    const summary = await withLiveSearch(
      { maxPagesPerSearch: config.maxPagesPerSearch },
      (search, pause) =>
        runListener(
          {
            db,
            search,
            pause,
            now: () => new Date(),
            sekToEur: config.sekToEur,
            log: console.warn,
          },
          listener,
        ),
    );

    console.table(summary.sources);
    if (summary.kind === 'seed') {
      console.log(
        summary.activated
          ? 'Seed complete: the listener is now active.'
          : 'Seed incomplete: the listener stays pending and is retried when next due.',
      );
    }
    return summary.sources.every((source) => source.status === 'ok') ? 0 : 1;
  } finally {
    await lock.release();
  }
}
