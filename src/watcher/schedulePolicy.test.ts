import { describe, expect, it } from 'vitest';

import {
  gapEndsAt,
  gapJitterMinutes,
  nextExpectedRuns,
  pickNextListener,
  type ScheduleConfig,
} from './schedulePolicy';

const config: ScheduleConfig = {
  listenerIntervalHours: 24,
  minGapMinutes: 30,
  gapJitterMinutes: 0,
};

const at = (iso: string) => new Date(`2026-10-29T${iso}:00Z`);
const minutes = (date: Date, count: number) => new Date(date.getTime() + count * 60_000);
const hours = (date: Date, count: number) => minutes(date, count * 60);

interface TestListener {
  id: number;
  name: string;
  enabled: boolean;
  seedState: 'pending' | 'active';
  lastRunAt: Date | null;
}

function listener(id: number, overrides: Partial<TestListener> = {}): TestListener {
  return {
    id,
    name: `Listener ${id}`,
    enabled: true,
    seedState: 'active',
    lastRunAt: null,
    ...overrides,
  };
}

describe('pickNextListener', () => {
  it('runs a pending seed before an active listener that has waited longer', () => {
    const decision = pickNextListener({
      listeners: [
        listener(1, { lastRunAt: hours(at('12:00'), -48) }),
        listener(2, { seedState: 'pending' }),
      ],
      lastRunEndedAt: null,
      now: at('12:00'),
      config,
    });
    expect(decision).toMatchObject({ run: true, listener: { id: 2 } });
  });

  it('picks the longest-waiting due listener', () => {
    const now = at('12:00');
    const decision = pickNextListener({
      listeners: [
        listener(1, { lastRunAt: hours(now, -25) }),
        listener(2, { lastRunAt: hours(now, -30) }),
        listener(3, { lastRunAt: hours(now, -1) }),
      ],
      lastRunEndedAt: null,
      now,
      config,
    });
    expect(decision).toMatchObject({ run: true, listener: { id: 2 } });
  });

  it('refuses a listener that ran less than the interval ago, saying when it is due', () => {
    const now = at('12:00');
    const decision = pickNextListener({
      listeners: [listener(1, { name: 'Viveca Sten', lastRunAt: hours(now, -23) })],
      lastRunEndedAt: hours(now, -23),
      now,
      config,
    });
    expect(decision).toEqual({
      run: false,
      reason: 'Viveca Sten has run within the last 24 hours; next due at 2026-10-29T13:00:00.000Z',
      retryAt: at('13:00'),
    });
  });

  it('waits for the gap after the previous run of any listener', () => {
    const now = at('12:00');
    const decision = pickNextListener({
      listeners: [listener(1)],
      lastRunEndedAt: minutes(now, -29),
      now,
      config,
    });
    expect(decision).toMatchObject({ run: false, retryAt: minutes(now, 1) });
    expect(
      pickNextListener({
        listeners: [listener(1)],
        lastRunEndedAt: minutes(now, -30),
        now,
        config,
      }),
    ).toMatchObject({ run: true });
  });

  it('refuses a disabled listener', () => {
    const decision = pickNextListener({
      listeners: [listener(1, { name: 'Viveca Sten', enabled: false })],
      lastRunEndedAt: null,
      now: at('12:00'),
      config,
    });
    expect(decision).toEqual({ run: false, reason: 'Viveca Sten is disabled', retryAt: null });
  });

  it('with a fake clock over three days, runs each listener at most once a day and never closer than the gap', () => {
    const jittered = { ...config, gapJitterMinutes: 10 };
    const listeners = [1, 2, 3, 4, 5].map((id) =>
      listener(id, { seedState: id === 5 ? 'pending' : 'active' }),
    );
    const starts: { id: number; at: Date }[] = [];
    let lastRunEndedAt: Date | null = null;

    for (let now = at('00:00'); now < hours(at('00:00'), 72); now = minutes(now, 1)) {
      const decision = pickNextListener({ listeners, lastRunEndedAt, now, config: jittered });
      if (!decision.run) continue;
      starts.push({ id: decision.listener.id, at: now });
      // Each run takes 7 minutes; the scheduler sees the end on a later tick.
      const ended = minutes(now, 7);
      decision.listener.lastRunAt = ended;
      decision.listener.seedState = 'active';
      lastRunEndedAt = ended;
      now = ended;
    }

    expect(starts[0].id).toBe(5);
    for (const id of [1, 2, 3, 4, 5]) {
      const times = starts.filter((start) => start.id === id).map((start) => start.at.getTime());
      expect(times).toHaveLength(3);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(24 * 3_600_000);
      }
    }
    for (let i = 1; i < starts.length; i++) {
      const previousEnd = minutes(starts[i - 1].at, 7);
      expect(starts[i].at.getTime() - previousEnd.getTime()).toBeGreaterThanOrEqual(30 * 60_000);
    }
  });
});

describe('gap jitter', () => {
  it('stays within 0 and the maximum, and is the same on every check for one gap', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const ended = minutes(at('00:00'), i * 37);
      const jitter = gapJitterMinutes(ended, 10);
      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(10);
      expect(gapJitterMinutes(ended, 10)).toBe(jitter);
      seen.add(jitter);
    }
    expect(seen.size).toBe(11);
  });

  it('adds the jitter to the minimum gap', () => {
    const ended = at('12:00');
    const end = gapEndsAt(ended, { ...config, gapJitterMinutes: 10 });
    expect(end).toEqual(minutes(ended, 30 + gapJitterMinutes(ended, 10)));
  });
});

describe('nextExpectedRuns', () => {
  it('lines up due listeners one average gap apart, then the rest when they come due', () => {
    const now = at('12:00');
    const expected = nextExpectedRuns({
      listeners: [
        listener(1, { lastRunAt: hours(now, -2) }),
        listener(2, { seedState: 'pending' }),
        listener(3, { lastRunAt: hours(now, -30) }),
        listener(4, { enabled: false }),
      ],
      lastRunEndedAt: minutes(now, -10),
      now,
      config: { ...config, gapJitterMinutes: 10 },
    });

    const gapEnd = gapEndsAt(minutes(now, -10), { ...config, gapJitterMinutes: 10 }) as Date;
    expect(expected.get(2)).toEqual(gapEnd);
    expect(expected.get(3)).toEqual(minutes(gapEnd, 35));
    expect(expected.get(1)).toEqual(hours(now, 22));
    expect(expected.has(4)).toBe(false);
  });
});
