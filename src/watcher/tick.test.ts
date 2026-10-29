import { describe, expect, it } from 'vitest';

import type { Listener } from '../db/listeners';
import type { DigestOutcome } from '../notifications/sendDailyDigest';
import type { RunSummary } from './runListener';
import { createTicker, type TickDeps } from './tick';

const start = new Date('2026-10-29T12:00:00Z');
const minutes = (count: number) => new Date(start.getTime() + count * 60_000);

function listener(id: number, overrides: Partial<Listener> = {}): Listener {
  return {
    id,
    name: `Listener ${id}`,
    author: 'Author',
    language: 'sv',
    format: 'ebook',
    minPriceEur: null,
    maxPriceEur: null,
    sources: ['bokus'],
    enabled: true,
    seedState: 'active',
    seededAt: null,
    lastRunAt: null,
    createdAt: start,
    updatedAt: start,
    ...overrides,
  };
}

const summary: RunSummary = {
  kind: 'watch',
  sources: [{ source: 'bokus', status: 'ok', results: 1, newBooks: 0, error: null }],
  activated: false,
};

/** A world of fake listeners, a fake clock, a fake lock and runs that end when told to. */
function world(listeners: Listener[]) {
  let now = start;
  let lastRunEndedAt: Date | null = null;
  let lockHeld = false;
  const events: string[] = [];
  const pendingRuns: (() => void)[] = [];
  let digest: () => Promise<DigestOutcome> = () => Promise.resolve({ status: 'not-due' });
  let runOutcome: 'ok' | Error = 'ok';

  const deps: TickDeps = {
    now: () => now,
    log: (message) => events.push(`log: ${message}`),
    config: { listenerIntervalHours: 24, minGapMinutes: 30, gapJitterMinutes: 0 },
    digest: () => {
      events.push('digest');
      return digest();
    },
    acquireLock: () => {
      if (lockHeld) return Promise.resolve(null);
      lockHeld = true;
      return Promise.resolve({
        release: () => {
          lockHeld = false;
          return Promise.resolve();
        },
      });
    },
    loadSchedule: () => Promise.resolve({ listeners, lastRunEndedAt }),
    run: (picked) => {
      events.push(`run ${picked.id}`);
      if (runOutcome instanceof Error) return Promise.reject(runOutcome);
      return new Promise((resolve) =>
        pendingRuns.push(() => {
          picked.lastRunAt = now;
          lastRunEndedAt = now;
          resolve(summary);
        }),
      );
    },
  };

  return {
    ticker: createTicker(deps),
    events,
    at: (date: Date) => (now = date),
    finishRun: () => pendingRuns.shift()?.(),
    holdLock: () => (lockHeld = true),
    isLockHeld: () => lockHeld,
    setDigest: (fn: typeof digest) => (digest = fn),
    failRuns: (error: Error) => (runOutcome = error),
    runs: () => events.filter((event) => event.startsWith('run')),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createTicker', () => {
  it('with two due listeners, runs one at once and the second only after the gap', async () => {
    const w = world([listener(1), listener(2)]);

    const first = w.ticker.tick();
    await flush();
    expect(w.runs()).toEqual(['run 1']);

    // Ticks during the run start nothing.
    w.at(minutes(1));
    await w.ticker.tick();
    expect(w.runs()).toEqual(['run 1']);

    w.at(minutes(5));
    w.finishRun();
    await first;

    w.at(minutes(34));
    await w.ticker.tick();
    expect(w.runs()).toEqual(['run 1']);

    w.at(minutes(35));
    const second = w.ticker.tick();
    await flush();
    expect(w.runs()).toEqual(['run 1', 'run 2']);
    w.finishRun();
    await second;
    expect(w.isLockHeld()).toBe(false);
  });

  it('sends a due digest on a wake-up even while a listener run is in progress', async () => {
    const w = world([listener(1)]);
    const running = w.ticker.tick();
    await flush();

    w.setDigest(() =>
      Promise.resolve({ status: 'sent', bookIds: [7], error: null, recorded: true }),
    );
    await w.ticker.tick();

    expect(w.events).toEqual([
      'digest',
      'log: Watching Listener 1…',
      'run 1',
      'digest',
      'log: Digest sent, 1 book(s).',
    ]);
    w.finishRun();
    await running;
  });

  it('starts no run while another process holds the lock', async () => {
    const w = world([listener(1)]);
    w.holdLock();
    await w.ticker.tick();
    expect(w.runs()).toEqual([]);
  });

  it('logs a failed run and a failed digest, releases the lock, and keeps going', async () => {
    const w = world([listener(1), listener(2)]);
    w.failRuns(new Error('browser crashed'));
    w.setDigest(() => Promise.reject(new Error('database down')));

    await expect(w.ticker.tick()).resolves.toBeUndefined();

    expect(w.events).toContain('log: Listener run failed: browser crashed');
    expect(w.events).toContain('log: Digest step failed: database down');
    expect(w.isLockHeld()).toBe(false);
  });

  it('on stop, waits for the run in progress and starts nothing more', async () => {
    const w = world([listener(1), listener(2)]);
    const running = w.ticker.tick();
    await flush();

    let stopped = false;
    const stopping = w.ticker.stop().then(() => (stopped = true));
    await flush();
    expect(stopped).toBe(false);

    w.finishRun();
    await Promise.all([running, stopping]);
    expect(stopped).toBe(true);

    w.at(minutes(120));
    await w.ticker.tick();
    expect(w.runs()).toEqual(['run 1']);
  });
});
