import { describe, expect, it } from 'vitest';

import { isDigestDue, localDate } from './digestPolicy';

// Local times, as the digest time is local.
const at = (hour: number, minute = 0) => new Date(2026, 9, 29, hour, minute);

const base = { digestTime: '05:00', completedToday: false, lastFailedAt: null };

describe('isDigestDue', () => {
  it('is not due before the digest time', () => {
    expect(isDigestDue({ ...base, now: at(4, 59) })).toBe(false);
  });

  it('is due at the digest time, and later the same day if it was missed', () => {
    expect(isDigestDue({ ...base, now: at(5) })).toBe(true);
    expect(isDigestDue({ ...base, now: at(9, 30) })).toBe(true);
  });

  it('is not due again once today’s digest completed', () => {
    expect(isDigestDue({ ...base, now: at(9, 30), completedToday: true })).toBe(false);
  });

  it('retries a failed digest after 30 minutes', () => {
    const failed = { ...base, lastFailedAt: at(5) };
    expect(isDigestDue({ ...failed, now: at(5, 29) })).toBe(false);
    expect(isDigestDue({ ...failed, now: at(5, 30) })).toBe(true);
  });

  it('honours a digest time other than the default', () => {
    expect(isDigestDue({ ...base, digestTime: '18:15', now: at(18, 14) })).toBe(false);
    expect(isDigestDue({ ...base, digestTime: '18:15', now: at(18, 15) })).toBe(true);
  });
});

describe('localDate', () => {
  it('gives the local calendar day', () => {
    expect(localDate(at(0, 5))).toBe('2026-10-29');
    expect(localDate(at(23, 55))).toBe('2026-10-29');
  });
});
