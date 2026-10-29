/** How long a failed digest waits before the next attempt (spec US-5). */
export const DIGEST_RETRY_MINUTES = 30;

/** The local calendar day of `date`, 'YYYY-MM-DD'; digests belong to local days. */
export function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DigestDueInput {
  now: Date;
  /** 'HH:MM', local time. */
  digestTime: string;
  /** A digest was sent, mocked or found empty today. */
  completedToday: boolean;
  /** Today's latest failed attempt, if any. */
  lastFailedAt: Date | null;
}

/**
 * Whether the daily digest should go out now: it is past the digest time today, no
 * digest has completed today, and the last failure, if any, was at least 30 minutes
 * ago. A scheduler that was not running at the digest time catches up on its first
 * check after it.
 */
export function isDigestDue({
  now,
  digestTime,
  completedToday,
  lastFailedAt,
}: DigestDueInput): boolean {
  const [hours, minutes] = digestTime.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < hours * 60 + minutes || completedToday) return false;
  return (
    lastFailedAt === null || now.getTime() - lastFailedAt.getTime() >= DIGEST_RETRY_MINUTES * 60_000
  );
}
