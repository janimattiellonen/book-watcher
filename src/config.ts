import { z } from 'zod';

import { parseEnv } from './parseEnv.js';

const positiveInt = z.coerce.number().int().positive();

// Settings for the scheduler and the scrapers. E-mail settings join this schema when
// notifications are built (plan task 11).
const schema = z.object({
  /** Minimum hours between two runs of the same listener. Below 24 would hit the stores more than once a day. */
  LISTENER_INTERVAL_HOURS: positiveInt
    .default(24)
    .refine((hours) => hours >= 24, 'must be at least 24 (each listener runs at most once a day)'),
  /** Minimum minutes between the end of one listener run and the start of the next. */
  MIN_GAP_MINUTES: positiveInt.default(30),
  /** Random extra wait, 0 to this many minutes, added to every gap. */
  GAP_JITTER_MINUTES: z.coerce.number().int().min(0).default(10),
  /** Upper bound on result pages loaded per source in one search. */
  MAX_PAGES_PER_SEARCH: positiveInt.default(10),
  /** Price of one Swedish krona in euros, for Bokus prices. */
  SEK_TO_EUR: z.coerce.number().positive().default(0.087),
});

export interface Config {
  listenerIntervalHours: number;
  minGapMinutes: number;
  gapJitterMinutes: number;
  maxPagesPerSearch: number;
  sekToEur: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = parseEnv('book watcher', schema, env);
  return {
    listenerIntervalHours: parsed.LISTENER_INTERVAL_HOURS,
    minGapMinutes: parsed.MIN_GAP_MINUTES,
    gapJitterMinutes: parsed.GAP_JITTER_MINUTES,
    maxPagesPerSearch: parsed.MAX_PAGES_PER_SEARCH,
    sekToEur: parsed.SEK_TO_EUR,
  };
}
