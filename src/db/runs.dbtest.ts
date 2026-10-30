import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createListener, deleteListener } from './listeners.js';
import {
  averageRunSeconds,
  finishRun,
  hadResultsBefore,
  lastFinishedAt,
  listRecentRuns,
  type RunOutcome,
  startRun,
} from './runs.js';
import { createTestPool, truncateAll } from './testPool.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 12, minute));

async function listener(name = 'Viveca Sten'): Promise<number> {
  const { id } = await createListener(db, {
    name,
    author: name,
    language: 'sv',
    format: 'ebook',
    minPriceEur: null,
    maxPriceEur: null,
    sources: ['adlibris', 'bokus'],
    enabled: true,
  });
  return id;
}

const ok = (results: number, now: Date): RunOutcome => ({
  status: 'ok',
  results,
  newBooks: 0,
  error: null,
  now,
});

describe('startRun and finishRun', () => {
  it('records a run from start to finish', async () => {
    const listenerId = await listener();
    const id = await startRun(db, { listenerId, source: 'bokus', kind: 'seed', now: at(0) });

    const [running] = await listRecentRuns(db, { limit: 10 });
    expect(running).toMatchObject({ id, status: 'running', startedAt: at(0), finishedAt: null });

    await finishRun(db, id, {
      status: 'failed',
      results: null,
      newBooks: null,
      error: 'Blocked',
      now: at(1),
    });

    const [finished] = await listRecentRuns(db, { limit: 10 });
    expect(finished).toMatchObject({
      id,
      listenerId,
      listenerName: 'Viveca Sten',
      source: 'bokus',
      kind: 'seed',
      status: 'failed',
      error: 'Blocked',
      finishedAt: at(1),
    });
  });
});

describe('lastFinishedAt', () => {
  it('is null before any run has finished', async () => {
    const listenerId = await listener();
    await startRun(db, { listenerId, source: 'bokus', kind: 'seed', now: at(0) });
    expect(await lastFinishedAt(db)).toBeNull();
  });

  it('is the latest end of any run, also of a deleted listener', async () => {
    const a = await listener('A');
    const b = await listener('B');
    await finishRun(
      db,
      await startRun(db, { listenerId: a, source: 'bokus', kind: 'watch', now: at(0) }),
      ok(1, at(5)),
    );
    await finishRun(
      db,
      await startRun(db, { listenerId: b, source: 'bokus', kind: 'watch', now: at(10) }),
      ok(1, at(15)),
    );

    await deleteListener(db, b);

    expect(await lastFinishedAt(db)).toEqual(at(15));
  });
});

describe('hadResultsBefore', () => {
  it('is true only once a search of that source returned results', async () => {
    const listenerId = await listener();
    await finishRun(
      db,
      await startRun(db, { listenerId, source: 'bokus', kind: 'seed', now: at(0) }),
      ok(0, at(1)),
    );
    expect(await hadResultsBefore(db, listenerId, 'bokus')).toBe(false);

    await finishRun(
      db,
      await startRun(db, { listenerId, source: 'adlibris', kind: 'seed', now: at(2) }),
      ok(4, at(3)),
    );
    expect(await hadResultsBefore(db, listenerId, 'bokus')).toBe(false);
    expect(await hadResultsBefore(db, listenerId, 'adlibris')).toBe(true);
  });
});

describe('listRecentRuns', () => {
  it('lists the newest runs first, up to the limit, optionally for one listener', async () => {
    const a = await listener('A');
    const b = await listener('B');
    const first = await startRun(db, { listenerId: a, source: 'bokus', kind: 'seed', now: at(0) });
    const second = await startRun(db, { listenerId: b, source: 'bokus', kind: 'seed', now: at(1) });
    const third = await startRun(db, {
      listenerId: a,
      source: 'adlibris',
      kind: 'seed',
      now: at(2),
    });

    expect((await listRecentRuns(db, { limit: 2 })).map((run) => run.id)).toEqual([third, second]);
    expect((await listRecentRuns(db, { limit: 10, listenerId: a })).map((run) => run.id)).toEqual([
      third,
      first,
    ]);
  });

  it('keeps the runs of a deleted listener, without a name', async () => {
    const listenerId = await listener();
    await startRun(db, { listenerId, source: 'bokus', kind: 'seed', now: at(0) });
    await deleteListener(db, listenerId);

    const [run] = await listRecentRuns(db, { limit: 10 });
    expect(run).toMatchObject({ listenerId: null, listenerName: null });
  });
});

describe('averageRunSeconds', () => {
  it('averages the latest finished runs, ignoring one still running', async () => {
    expect(await averageRunSeconds(db)).toBeNull();

    const listenerId = await listener();
    await finishRun(
      db,
      await startRun(db, { listenerId, source: 'bokus', kind: 'seed', now: at(0) }),
      ok(1, at(1)),
    );
    await finishRun(
      db,
      await startRun(db, { listenerId, source: 'adlibris', kind: 'seed', now: at(2) }),
      ok(1, at(5)),
    );
    await startRun(db, { listenerId, source: 'bokus', kind: 'watch', now: at(10) });

    expect(await averageRunSeconds(db)).toBe(120);
    // Only the latest one.
    expect(await averageRunSeconds(db, 1)).toBe(180);
  });
});
