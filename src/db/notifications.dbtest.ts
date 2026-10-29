import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getDigestDay, type NotificationInput, recordNotification } from './notifications.js';
import { createTestPool, truncateAll } from './testPool.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

const at = (hour: number, minute = 0) => new Date(2026, 9, 29, hour, minute);

function attempt(overrides: Partial<NotificationInput>): NotificationInput {
  return {
    digestDate: '2026-10-29',
    bookIds: [],
    status: 'sent',
    error: null,
    now: at(5),
    ...overrides,
  };
}

describe('getDigestDay', () => {
  it('reports a day without attempts as neither completed nor failed', async () => {
    expect(await getDigestDay(db, '2026-10-29')).toEqual({ completed: false, lastFailedAt: null });
  });

  it('reports the latest failure of a day that has not completed', async () => {
    await recordNotification(db, attempt({ status: 'failed', error: 'SMTP down', now: at(5) }));
    await recordNotification(db, attempt({ status: 'failed', error: 'SMTP down', now: at(5, 30) }));

    expect(await getDigestDay(db, '2026-10-29')).toEqual({
      completed: false,
      lastFailedAt: at(5, 30),
    });
  });

  it.each(['sent', 'mocked', 'empty'] as const)(
    'counts a %s digest as completed',
    async (status) => {
      await recordNotification(db, attempt({ status: 'failed', error: 'SMTP down', now: at(5) }));
      await recordNotification(db, attempt({ status, bookIds: [1, 2], now: at(5, 30) }));

      expect((await getDigestDay(db, '2026-10-29')).completed).toBe(true);
    },
  );

  it('looks only at the given day', async () => {
    await recordNotification(db, attempt({ digestDate: '2026-10-28', status: 'sent' }));
    expect((await getDigestDay(db, '2026-10-29')).completed).toBe(false);
  });

  it('keeps one completed digest per day, and says when it did not record another', async () => {
    expect(await recordNotification(db, attempt({ status: 'sent' }))).toBe(true);
    expect(await recordNotification(db, attempt({ status: 'empty' }))).toBe(false);
    expect(await recordNotification(db, attempt({ status: 'failed', error: 'x' }))).toBe(true);
    const { rows } = await db.query('SELECT status FROM notifications ORDER BY id');
    expect(rows).toEqual([{ status: 'sent' }, { status: 'failed' }]);
  });
});

describe('recordNotification', () => {
  it('stores the date as given and the book ids', async () => {
    await recordNotification(db, attempt({ bookIds: [3, 1] }));
    const { rows } = await db.query('SELECT digest_date, book_ids, status FROM notifications');
    expect(rows).toEqual([{ digest_date: '2026-10-29', book_ids: [3, 1], status: 'sent' }]);
  });
});
