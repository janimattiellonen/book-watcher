import type { Listener } from '../db/listeners.js';
import type { ScheduleConfig } from './schedulePolicy.js';

export interface CapacityInput {
  listeners: readonly Pick<Listener, 'enabled' | 'sources'>[];
  /** How long one listener-source search takes on average; null before any run. */
  averageRunSeconds: number | null;
  /**
   * How long one run's Adlibris series lookups take on average; null (the default)
   * before any. Only listeners that search Adlibris make lookups.
   */
  averageSeriesLookupSeconds?: number | null;
  config: ScheduleConfig;
}

export interface Capacity {
  /** How long running every enabled listener once takes, gaps included. */
  cycleMinutes: number;
  /** The interval each listener should run within. */
  intervalMinutes: number;
  fits: boolean;
}

/**
 * Whether the enabled listeners all fit into one interval (spec: capacity). Each takes
 * its searches, one per source, its series lookups if it searches Adlibris, and the
 * average gap after it. With the defaults and no run time yet, that is 35 minutes each,
 * so about 41 listeners fit into 24 hours.
 */
export function scheduleCapacity({
  listeners,
  averageRunSeconds,
  averageSeriesLookupSeconds = null,
  config,
}: CapacityInput): Capacity {
  const averageGapMinutes = config.minGapMinutes + config.gapJitterMinutes / 2;
  const searchMinutes = (averageRunSeconds ?? 0) / 60;
  const lookupMinutes = (averageSeriesLookupSeconds ?? 0) / 60;
  const cycleMinutes = listeners
    .filter((listener) => listener.enabled)
    .reduce(
      (sum, listener) =>
        sum +
        averageGapMinutes +
        listener.sources.length * searchMinutes +
        (listener.sources.includes('adlibris') ? lookupMinutes : 0),
      0,
    );
  const intervalMinutes = config.listenerIntervalHours * 60;
  return { cycleMinutes, intervalMinutes, fits: cycleMinutes <= intervalMinutes };
}
