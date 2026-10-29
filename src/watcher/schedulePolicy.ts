import type { Listener } from '../db/listeners.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface ScheduleConfig {
  listenerIntervalHours: number;
  minGapMinutes: number;
  gapJitterMinutes: number;
}

type ScheduledListener = Pick<Listener, 'id' | 'name' | 'enabled' | 'seedState' | 'lastRunAt'>;

export interface ScheduleInput<L extends ScheduledListener> {
  listeners: readonly L[];
  /** When the most recent run of any listener ended, or null if none has. */
  lastRunEndedAt: Date | null;
  now: Date;
  config: ScheduleConfig;
}

export type ScheduleDecision<L> =
  | { run: true; listener: L }
  | {
      run: false;
      reason: string;
      /** The earliest time anything could run, or null when nothing is waiting to. */
      retryAt: Date | null;
    };

/**
 * The extra wait, 0 to `maxMinutes` whole minutes, added to the gap after the run that
 * ended at `lastRunEndedAt`. It is derived from that time rather than drawn on every
 * check, so one gap keeps one length however often the scheduler asks.
 */
export function gapJitterMinutes(lastRunEndedAt: Date, maxMinutes: number): number {
  const seconds = Math.floor(lastRunEndedAt.getTime() / 1000);
  const fraction = (Math.imul(seconds, 2654435761) >>> 0) / 2 ** 32;
  return Math.floor(fraction * (maxMinutes + 1));
}

/** When the next run may start at the earliest, given when the last one ended. */
export function gapEndsAt(lastRunEndedAt: Date | null, config: ScheduleConfig): Date | null {
  if (!lastRunEndedAt) return null;
  const minutes = config.minGapMinutes + gapJitterMinutes(lastRunEndedAt, config.gapJitterMinutes);
  return new Date(lastRunEndedAt.getTime() + minutes * MINUTE_MS);
}

/** When the listener is next due: right away if it never ran, else one interval after its last run. */
export function dueAt(listener: ScheduledListener, config: ScheduleConfig): Date | null {
  return listener.lastRunAt
    ? new Date(listener.lastRunAt.getTime() + config.listenerIntervalHours * HOUR_MS)
    : null;
}

function isDue(listener: ScheduledListener, now: Date, config: ScheduleConfig): boolean {
  const due = dueAt(listener, config);
  return due === null || due <= now;
}

/** Pending seeds first, then the longest-waiting; never-run listeners before any that ran. */
function byPickOrder(a: ScheduledListener, b: ScheduledListener): number {
  const pending = Number(b.seedState === 'pending') - Number(a.seedState === 'pending');
  if (pending !== 0) return pending;
  const at = (listener: ScheduledListener) => listener.lastRunAt?.getTime() ?? -Infinity;
  return at(a) - at(b) || a.id - b.id;
}

const formatTime = (date: Date) => date.toISOString();

/**
 * Decides whether a listener may start now, and which (spec US-6): each listener runs
 * at most once per interval, a run starts only once the gap since the previous run of
 * any listener has passed, and pending seeds go before the longest-waiting listener.
 * Called with a single listener, it answers whether a manual run of it may start.
 */
export function pickNextListener<L extends ScheduledListener>({
  listeners,
  lastRunEndedAt,
  now,
  config,
}: ScheduleInput<L>): ScheduleDecision<L> {
  const enabled = listeners.filter((listener) => listener.enabled);
  if (enabled.length === 0) {
    const only = listeners.length === 1 ? listeners[0] : null;
    return {
      run: false,
      reason: only ? `${only.name} is disabled` : 'No enabled listeners',
      retryAt: null,
    };
  }

  const due = enabled.filter((listener) => isDue(listener, now, config)).sort(byPickOrder);
  if (due.length === 0) {
    const next = enabled
      .map((listener) => dueAt(listener, config))
      .filter((at): at is Date => at !== null)
      .reduce((earliest, at) => (at < earliest ? at : earliest));
    const subject = enabled.length === 1 ? `${enabled[0].name} has` : 'Every listener has';
    return {
      run: false,
      reason: `${subject} run within the last ${config.listenerIntervalHours} hours; next due at ${formatTime(next)}`,
      retryAt: next,
    };
  }

  const gapEnd = gapEndsAt(lastRunEndedAt, config);
  if (gapEnd && gapEnd > now) {
    return {
      run: false,
      reason: `The previous run ended at ${formatTime(lastRunEndedAt as Date)}; the next may start at ${formatTime(gapEnd)}`,
      retryAt: gapEnd,
    };
  }

  return { run: true, listener: due[0] };
}

/**
 * When each enabled listener is expected to run next, for the listeners page. It plays
 * the picking order forward from `now`, one listener per gap, assuming runs take no
 * time and an average jitter, so it is an estimate.
 */
export function nextExpectedRuns<L extends ScheduledListener>({
  listeners,
  lastRunEndedAt,
  now,
  config,
}: ScheduleInput<L>): Map<number, Date> {
  const averageGapMs = (config.minGapMinutes + config.gapJitterMinutes / 2) * MINUTE_MS;
  const expected = new Map<number, Date>();
  const waiting = listeners.filter((listener) => listener.enabled).sort(byPickOrder);

  const gapEnd = gapEndsAt(lastRunEndedAt, config);
  let slot = gapEnd && gapEnd > now ? gapEnd : now;
  while (waiting.length > 0) {
    let index = waiting.findIndex((listener) => isDue(listener, slot, config));
    if (index === -1) {
      // Nobody is due at this slot: move on to whoever comes due first.
      const dueTimes = waiting.map((listener) => (dueAt(listener, config) as Date).getTime());
      const earliest = Math.min(...dueTimes);
      slot = new Date(earliest);
      index = dueTimes.indexOf(earliest);
    }
    const [listener] = waiting.splice(index, 1);
    expected.set(listener.id, slot);
    slot = new Date(slot.getTime() + averageGapMs);
  }
  return expected;
}
