import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  activateListener,
  createListener,
  deleteListener,
  getListener,
  type ListenerInput,
  listDue,
  listListeners,
  setLastRunAt,
  setListenerEnabled,
  updateListener,
} from './listeners.js';
import { createTestPool, truncateAll } from './testPool.js';

const db = createTestPool();

afterAll(() => db.end());

beforeEach(() => truncateAll(db));

const now = new Date('2026-10-29T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

function input(overrides: Partial<ListenerInput> = {}): ListenerInput {
  return {
    name: 'Viveca Sten',
    author: 'Viveca Sten',
    language: 'sv',
    format: 'ebook',
    minPriceEur: null,
    maxPriceEur: 10,
    sources: ['bokus'],
    enabled: true,
    ...overrides,
  };
}

describe('createListener and getListener', () => {
  it('stores a listener as pending, and reads it back', async () => {
    const created = await createListener(db, input({ minPriceEur: 2.5 }));

    expect(created).toMatchObject({
      name: 'Viveca Sten',
      minPriceEur: 2.5,
      maxPriceEur: 10,
      sources: ['bokus'],
      seedState: 'pending',
      seededAt: null,
      lastRunAt: null,
    });
    expect(await getListener(db, created.id)).toEqual(created);
  });

  it('returns null for an unknown id', async () => {
    expect(await getListener(db, 999)).toBeNull();
  });
});

describe('listListeners', () => {
  it('orders by name, ignoring case', async () => {
    await createListener(db, input({ name: 'arto Paasilinna' }));
    await createListener(db, input({ name: 'Viveca Sten' }));
    await createListener(db, input({ name: 'Astrid Lindgren' }));

    const names = (await listListeners(db)).map((listener) => listener.name);
    expect(names).toEqual(['arto Paasilinna', 'Astrid Lindgren', 'Viveca Sten']);
  });
});

describe('updateListener', () => {
  it('replaces the form fields and leaves the seed state alone', async () => {
    const { id } = await createListener(db, input());
    await activateListener(db, id, now);

    const updated = await updateListener(
      db,
      id,
      input({ name: 'Sten', sources: ['adlibris', 'bokus'], maxPriceEur: null, enabled: false }),
    );

    expect(updated).toMatchObject({
      name: 'Sten',
      sources: ['adlibris', 'bokus'],
      maxPriceEur: null,
      enabled: false,
      seedState: 'active',
    });
  });

  it('returns null for an unknown id', async () => {
    expect(await updateListener(db, 999, input())).toBeNull();
  });
});

describe('setListenerEnabled and deleteListener', () => {
  it('disables a listener', async () => {
    const { id } = await createListener(db, input());
    expect(await setListenerEnabled(db, id, false)).toBe(true);
    expect((await getListener(db, id))?.enabled).toBe(false);
  });

  it('deletes a listener, and reports whether there was one', async () => {
    const { id } = await createListener(db, input());
    expect(await deleteListener(db, id)).toBe(true);
    expect(await getListener(db, id)).toBeNull();
    expect(await deleteListener(db, id)).toBe(false);
  });
});

describe('listDue', () => {
  it('returns enabled listeners that never ran or ran at least the interval ago', async () => {
    const never = await createListener(db, input({ name: 'never' }));
    const exactly = await createListener(db, input({ name: 'exactly 24 h' }));
    const recent = await createListener(db, input({ name: 'recent' }));
    const disabled = await createListener(db, input({ name: 'disabled', enabled: false }));
    await setLastRunAt(db, exactly.id, hoursAgo(24));
    await setLastRunAt(db, recent.id, hoursAgo(23));

    const due = (await listDue(db, now, 24)).map((listener) => listener.id);

    expect(due).toEqual([never.id, exactly.id]);
    expect(due).not.toContain(disabled.id);
  });

  it('puts pending seeds first, then the longest-waiting', async () => {
    const activeOld = await createListener(db, input({ name: 'active, 48 h' }));
    const activeNewer = await createListener(db, input({ name: 'active, 30 h' }));
    const pending = await createListener(db, input({ name: 'pending, 25 h' }));
    for (const { id } of [activeOld, activeNewer]) await activateListener(db, id, hoursAgo(72));
    await setLastRunAt(db, activeOld.id, hoursAgo(48));
    await setLastRunAt(db, activeNewer.id, hoursAgo(30));
    await setLastRunAt(db, pending.id, hoursAgo(25));

    const due = (await listDue(db, now, 24)).map((listener) => listener.id);

    expect(due).toEqual([pending.id, activeOld.id, activeNewer.id]);
  });
});

describe('activateListener', () => {
  it('marks a pending listener active with the seed time', async () => {
    const { id } = await createListener(db, input());
    await activateListener(db, id, now);
    expect(await getListener(db, id)).toMatchObject({ seedState: 'active', seededAt: now });
  });

  it('keeps the first seed time if called again', async () => {
    const { id } = await createListener(db, input());
    await activateListener(db, id, hoursAgo(1));
    await activateListener(db, id, now);
    expect((await getListener(db, id))?.seededAt).toEqual(hoursAgo(1));
  });
});
