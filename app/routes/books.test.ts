import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as BooksModule from '../../src/db/books';
import { listBooks, setStatus } from '../../src/db/books';
import { listListeners } from '../../src/db/listeners';
import { action } from './bookStatus';
import { loader } from './books';

vi.mock('../lib/db.server', () => ({ db: {} }));
vi.mock('../../src/db/books', async (importOriginal) => ({
  ...(await importOriginal<typeof BooksModule>()),
  listBooks: vi.fn(() => Promise.resolve([])),
  setStatus: vi.fn(() => Promise.resolve(1)),
}));
vi.mock('../../src/db/listeners', () => ({ listListeners: vi.fn(() => Promise.resolve([])) }));

// The route args carry more than these tests use.
type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];
const loaderArgs = (view: string | undefined, search = '') =>
  ({
    params: { view },
    // A data request, as React Router sends on client-side navigation.
    request: new Request(`http://localhost/_root.data${search}`),
  }) as unknown as LoaderArgs;
const actionArgs = (body: string) =>
  ({
    request: new Request('http://localhost/books/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }),
  }) as unknown as ActionArgs;

beforeEach(() => {
  vi.mocked(listBooks).mockClear();
  vi.mocked(setStatus).mockClear();
  vi.mocked(listListeners).mockClear();
});

describe('books loader', () => {
  it('lists the status of the page, filtered by listener', async () => {
    await loader(loaderArgs('reading-list', '?listener=4'));
    expect(listBooks).toHaveBeenCalledWith({}, { status: 'accepted', listenerId: 4 });

    await loader(loaderArgs(undefined));
    expect(listBooks).toHaveBeenLastCalledWith({}, { status: 'new', listenerId: undefined });
  });

  it('is a 404 for an unknown view', async () => {
    await expect(loader(loaderArgs('elsewhere'))).rejects.toMatchObject({ init: { status: 404 } });
    expect(listBooks).not.toHaveBeenCalled();
  });
});

describe('book status action', () => {
  it('moves the posted books and goes back to the page', async () => {
    const response = await action(
      actionArgs('bookId=3&bookId=5&status=rejected&redirectTo=%2F%3Flistener%3D4'),
    );

    expect(setStatus).toHaveBeenCalledWith({}, [3, 5], 'rejected');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/?listener=4');
  });

  it('refuses a bad form without touching the books', async () => {
    await expect(action(actionArgs('bookId=3&status=gone'))).rejects.toMatchObject({
      init: { status: 400 },
    });
    expect(setStatus).not.toHaveBeenCalled();
  });
});
