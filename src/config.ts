import { z } from 'zod';

import { parseEnv } from './parseEnv.js';

const positiveInt = z.coerce.number().int().positive();

/** 'true' or 'false'; anything else is a typo worth failing on. */
const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

// Settings for the scheduler, the scrapers and the daily digest.
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

  /** Off by default, so nothing is sent until notifications are opted into. */
  EMAIL_NOTIFICATIONS_ENABLED: flag(false),
  /** Local time of day the digest becomes due, 'HH:MM'. */
  DIGEST_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time such as 05:00')
    .default('05:00'),
  /** Log the digest instead of sending it. */
  EMAIL_MOCK_MODE: flag(false),
  EMAIL_PROVIDER: z.enum(['nodemailer', 'resend']).default('nodemailer'),
  /** Recipient of the digest; defaults to SMTP_USER. */
  EMAIL_TO: z.string().default(''),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: positiveInt.default(587),
  SMTP_SECURE: flag(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  RESEND_FROM: z.string().default('onboarding@resend.dev'),
});

export interface EmailConfig {
  provider: 'nodemailer' | 'resend';
  mockMode: boolean;
  /** Empty when neither EMAIL_TO nor SMTP_USER is set. */
  to: string;
  smtp: { host: string; port: number; secure: boolean; user: string; password: string };
  resend: { apiKey: string; from: string };
}

export interface Config {
  listenerIntervalHours: number;
  minGapMinutes: number;
  gapJitterMinutes: number;
  maxPagesPerSearch: number;
  sekToEur: number;
  emailNotificationsEnabled: boolean;
  /** 'HH:MM', local time. */
  digestTime: string;
  email: EmailConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = parseEnv('book watcher', schema, env);
  return {
    listenerIntervalHours: parsed.LISTENER_INTERVAL_HOURS,
    minGapMinutes: parsed.MIN_GAP_MINUTES,
    gapJitterMinutes: parsed.GAP_JITTER_MINUTES,
    maxPagesPerSearch: parsed.MAX_PAGES_PER_SEARCH,
    sekToEur: parsed.SEK_TO_EUR,
    emailNotificationsEnabled: parsed.EMAIL_NOTIFICATIONS_ENABLED,
    digestTime: parsed.DIGEST_TIME,
    email: {
      provider: parsed.EMAIL_PROVIDER,
      mockMode: parsed.EMAIL_MOCK_MODE,
      to: parsed.EMAIL_TO || parsed.SMTP_USER,
      smtp: {
        host: parsed.SMTP_HOST,
        port: parsed.SMTP_PORT,
        secure: parsed.SMTP_SECURE,
        user: parsed.SMTP_USER,
        password: parsed.SMTP_PASSWORD,
      },
      resend: { apiKey: parsed.RESEND_API_KEY, from: parsed.RESEND_FROM },
    },
  };
}
