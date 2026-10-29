import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { setStatus, upsertFromResult, upsertOffer } from '../db/books.js';
import { createTestPool, truncateAll } from '../db/testPool.js';
import type { SearchResult } from '../sources/types.js';
import type { Email, SendEmail } from './mailer.js';
import { runDailyDigest, sendDailyDigest } from './sendDailyDigest.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

// Local times, as digests belong to local days.
const at = (hour: number, minute = 0) => new Date(2026, 9, 29, hour, minute);

function result(isbn: string): SearchResult {
  return {
    source: 'adlibris',
    title: `Book ${isbn.slice(-3)}`,
    authors: ['Viveca Sten'],
    isbn,
    format: 'ebook',
    language: 'sv',
    price: 6.99,
    currency: 'EUR',
    url: `https://www.adlibris.com/fi/kirja/book-${isbn}`,
    coverUrl: null,
  };
}

/** Stores a book the way a watch run does, queued for the digest when `notify`. */
async function book(isbn: string, notify = true): Promise<number> {
  const { book: stored } = await upsertFromResult(db, result(isbn), {
    inRange: true,
    notify,
    now: at(1),
  });
  await upsertOffer(db, {
    bookId: stored.id,
    source: 'adlibris',
    url: result(isbn).url,
    price: 6.99,
    currency: 'EUR',
    priceEur: 6.99,
    now: at(1),
  });
  return stored.id;
}

function fakeSend(outcome: 'sent' | 'mocked' | Error = 'sent') {
  const sent: Email[] = [];
  const send: SendEmail = (email) => {
    sent.push(email);
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  };
  return { send, sent };
}

async function queue() {
  const { rows } = await db.query<{ id: number; notify_pending: boolean; notified_at: Date }>(
    'SELECT id, notify_pending, notified_at FROM books ORDER BY id',
  );
  return rows;
}

async function attempts() {
  const { rows } = await db.query<{ digest_date: string; status: string; book_ids: number[] }>(
    'SELECT digest_date, status, book_ids FROM notifications ORDER BY id',
  );
  return rows;
}

describe('sendDailyDigest', () => {
  it('sends one e-mail with every queued book, then takes them off the queue', async () => {
    const first = await book('9789100000001');
    const second = await book('9789100000002');
    const seeded = await book('9789100000003', false);
    const { send, sent } = fakeSend();

    const digest = await sendDailyDigest(db, send, at(5));

    expect(digest).toEqual({
      status: 'sent',
      bookIds: [second, first],
      error: null,
      recorded: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Book Watcher: 2 new books');
    expect(sent[0].text).toContain('Book 001');
    expect(await queue()).toEqual([
      { id: first, notify_pending: false, notified_at: at(5) },
      { id: second, notify_pending: false, notified_at: at(5) },
      { id: seeded, notify_pending: false, notified_at: null },
    ]);
    expect(await attempts()).toEqual([
      { digest_date: '2026-10-29', status: 'sent', book_ids: [second, first] },
    ]);
  });

  it('records a mocked digest as completed', async () => {
    await book('9789100000001');
    const digest = await sendDailyDigest(db, fakeSend('mocked').send, at(5));
    expect(digest.status).toBe('mocked');
    expect((await queue())[0].notify_pending).toBe(false);
  });

  it('sends nothing when nothing is queued, and records an empty digest', async () => {
    await book('9789100000001', false);
    const { send, sent } = fakeSend();

    expect((await sendDailyDigest(db, send, at(5))).status).toBe('empty');
    expect(sent).toEqual([]);
    expect(await attempts()).toEqual([
      { digest_date: '2026-10-29', status: 'empty', book_ids: [] },
    ]);
  });

  it('keeps the books queued when sending fails, and records the failure', async () => {
    const id = await book('9789100000001');

    const digest = await sendDailyDigest(db, fakeSend(new Error('SMTP down')).send, at(5));

    expect(digest).toMatchObject({ status: 'failed', error: 'SMTP down' });
    expect(await queue()).toEqual([{ id, notify_pending: true, notified_at: null }]);
    expect(await attempts()).toEqual([
      { digest_date: '2026-10-29', status: 'failed', book_ids: [id] },
    ]);
  });

  it('leaves out queued books already moved out of the suggestions', async () => {
    const kept = await book('9789100000001');
    const rejected = await book('9789100000002');
    await setStatus(db, [rejected], 'rejected');

    const digest = await sendDailyDigest(db, fakeSend().send, at(5));

    expect(digest.bookIds).toEqual([kept]);
  });

  it('notifies each book at most once', async () => {
    await book('9789100000001');
    await sendDailyDigest(db, fakeSend().send, at(5));

    const { send, sent } = fakeSend();
    await sendDailyDigest(db, send, new Date(2026, 9, 30, 5));

    expect(sent).toEqual([]);
  });
});

describe('runDailyDigest', () => {
  const base = { db, digestTime: '05:00', enabled: true };

  it('does nothing at all while notifications are disabled, even when forced', async () => {
    const id = await book('9789100000001');
    const { send, sent } = fakeSend();

    const outcome = await runDailyDigest({
      ...base,
      send,
      now: at(5),
      enabled: false,
      force: true,
    });

    expect(outcome).toEqual({ status: 'disabled' });
    expect(sent).toEqual([]);
    expect(await attempts()).toEqual([]);
    expect(await queue()).toMatchObject([{ id, notify_pending: true }]);
  });

  it('sends once a day: not before the digest time, and not again after completing', async () => {
    await book('9789100000001');
    const { send, sent } = fakeSend();

    expect((await runDailyDigest({ ...base, send, now: at(4, 59) })).status).toBe('not-due');
    expect((await runDailyDigest({ ...base, send, now: at(5) })).status).toBe('sent');
    await book('9789100000002');
    expect((await runDailyDigest({ ...base, send, now: at(9) })).status).toBe('not-due');
    expect(sent).toHaveLength(1);
  });

  it('retries a failed send 30 minutes later', async () => {
    await book('9789100000001');

    await runDailyDigest({ ...base, send: fakeSend(new Error('down')).send, now: at(5) });
    const { send } = fakeSend();
    expect((await runDailyDigest({ ...base, send, now: at(5, 29) })).status).toBe('not-due');
    expect((await runDailyDigest({ ...base, send, now: at(5, 30) })).status).toBe('sent');
  });

  it('sends when forced on a day that already completed, without recording a second digest', async () => {
    await runDailyDigest({ ...base, send: fakeSend().send, now: at(5) });
    const id = await book('9789100000001');
    const { send, sent } = fakeSend();

    const outcome = await runDailyDigest({ ...base, send, now: at(9), force: true });

    expect(outcome).toMatchObject({ status: 'sent', bookIds: [id], recorded: false });
    expect(sent).toHaveLength(1);
    expect(await queue()).toMatchObject([{ id, notify_pending: false }]);
    expect((await attempts()).map((row) => row.status)).toEqual(['empty']);
  });
});
