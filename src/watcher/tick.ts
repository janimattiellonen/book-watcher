import type { Listener } from '../db/listeners.js';
import type { DigestOutcome } from '../notifications/sendDailyDigest.js';
import type { HeldLock } from './lock.js';
import type { RunSummary } from './runListener.js';
import { pickNextListener, type ScheduleConfig } from './schedulePolicy.js';

export interface TickDeps {
  now: () => Date;
  log: (message: string) => void;
  config: ScheduleConfig;
  /** The digest step. It never contacts the stores, so it doesn't wait for the gap. */
  digest: () => Promise<DigestOutcome>;
  acquireLock: () => Promise<HeldLock | null>;
  /** Read after taking the lock, so a manual run that just ended counts toward the gap. */
  loadSchedule: () => Promise<{ listeners: Listener[]; lastRunEndedAt: Date | null }>;
  run: (listener: Listener) => Promise<RunSummary>;
}

export interface Ticker {
  /** One scheduler wake-up: the digest if due, then at most one listener run. */
  tick(): Promise<void>;
  /** Stops new work; resolves once the digest and the run in progress are done. */
  stop(): Promise<void>;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The scheduler's wake-up logic (spec US-6). A wake-up first sends the digest if it is
 * due, then starts a listener run if the policy allows one. A run can outlast many
 * wake-ups: those still send a due digest, but start no run. Errors are logged and
 * never escape, so one failed run doesn't stop the scheduler.
 */
export function createTicker(deps: TickDeps): Ticker {
  let digestInFlight: Promise<void> | null = null;
  let runInFlight: Promise<void> | null = null;
  let stopped = false;

  async function digestStep(): Promise<void> {
    try {
      const outcome = await deps.digest();
      if (!('bookIds' in outcome)) return; // Disabled or not due: nothing happened.
      if (outcome.status === 'failed') {
        deps.log(`Digest failed: ${outcome.error}. The books stay queued; retrying in 30 minutes.`);
      } else {
        deps.log(`Digest ${outcome.status}, ${outcome.bookIds.length} book(s).`);
      }
    } catch (error) {
      deps.log(`Digest step failed: ${describe(error)}`);
    }
  }

  async function listenerStep(): Promise<void> {
    let lock: HeldLock | null = null;
    try {
      lock = await deps.acquireLock();
      if (!lock) return; // A manual run holds it.

      const { listeners, lastRunEndedAt } = await deps.loadSchedule();
      const decision = pickNextListener({
        listeners,
        lastRunEndedAt,
        now: deps.now(),
        config: deps.config,
      });
      if (!decision.run) return;

      const { listener } = decision;
      deps.log(`${listener.seedState === 'pending' ? 'Seeding' : 'Watching'} ${listener.name}…`);
      const summary = await deps.run(listener);
      const outcome = summary.sources
        .map(
          (source) =>
            `${source.source} ${source.status}${source.newBooks ? ` (${source.newBooks} new)` : ''}`,
        )
        .join(', ');
      deps.log(`${listener.name}: ${outcome}${summary.activated ? '; seeded, now active' : ''}`);
    } catch (error) {
      deps.log(`Listener run failed: ${describe(error)}`);
    } finally {
      await lock?.release().catch((error: unknown) => {
        deps.log(`Releasing the scraping lock failed: ${describe(error)}`);
      });
    }
  }

  return {
    async tick() {
      if (stopped) return;
      if (!digestInFlight) {
        digestInFlight = digestStep().finally(() => (digestInFlight = null));
      }
      await digestInFlight;
      if (stopped || runInFlight) return;
      runInFlight = listenerStep().finally(() => (runInFlight = null));
      await runInFlight;
    },
    async stop() {
      stopped = true;
      await Promise.all([digestInFlight, runInFlight]);
    },
  };
}
