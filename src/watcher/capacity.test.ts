import { describe, expect, it } from 'vitest';

import type { SourceId } from '../sources/types';
import { scheduleCapacity } from './capacity';

const config = { listenerIntervalHours: 24, minGapMinutes: 30, gapJitterMinutes: 10 };

const listeners = (count: number, sources: SourceId[] = ['adlibris', 'bokus'], enabled = true) =>
  Array.from({ length: count }, () => ({ enabled, sources }));

describe('scheduleCapacity', () => {
  it('fits 41 listeners into a day with the defaults and no run time yet, but not 42', () => {
    expect(scheduleCapacity({ listeners: listeners(41), averageRunSeconds: null, config })).toEqual(
      { cycleMinutes: 1435, intervalMinutes: 1440, fits: true },
    );
    expect(
      scheduleCapacity({ listeners: listeners(42), averageRunSeconds: null, config }).fits,
    ).toBe(false);
  });

  it('adds the run time of each source search', () => {
    // 35 min gap + 2 sources × 1.5 min = 38 min per listener.
    const capacity = (count: number) =>
      scheduleCapacity({ listeners: listeners(count), averageRunSeconds: 90, config });
    expect(capacity(37).fits).toBe(true);
    expect(capacity(38)).toMatchObject({ cycleMinutes: 1444, fits: false });
  });

  it('counts only enabled listeners, each by its own sources', () => {
    const capacity = scheduleCapacity({
      listeners: [...listeners(1, ['bokus']), ...listeners(1), ...listeners(50, ['bokus'], false)],
      averageRunSeconds: 60,
      config,
    });
    expect(capacity.cycleMinutes).toBe(35 + 1 + 35 + 2);
  });

  it('measures against the configured interval', () => {
    const capacity = scheduleCapacity({
      listeners: listeners(60),
      averageRunSeconds: null,
      config: { ...config, listenerIntervalHours: 48 },
    });
    expect(capacity).toMatchObject({ intervalMinutes: 2880, fits: true });
  });
});
