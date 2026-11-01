import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as BooksModule from '../../src/db/books';
import { type BookListItem, listSeriesBooks } from '../../src/db/books';
import { countWaitingLookups, getSeries } from '../../src/db/series';
import { loader } from './seriesDetail';

vi.mock('../lib/db.server', () => ({ db: {} }));
vi.mock('../../src/db/books', async (importOriginal) => ({
  ...(await importOriginal<typeof BooksModule>()),
  listSeriesBooks: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../src/db/series', () => ({
  getSeries: vi.fn(() => Promise.resolve(null)),
  countWaitingLookups: vi.fn(() => Promise.resolve(0)),
}));

type LoaderArgs = Parameters<typeof loader>[0];
const loaderArgs = (id: string) => ({ params: { id } }) as unknown as LoaderArgs;

const series = {
  id: 6,
  name: 'Morden i Sandhamn',
  author: 'Viveca Sten',
  authorKey: 'viveca sten',
};

// Only the fields the loader reads.
const book = (part: number | null, listeners: { id: number; name: string }[]) =>
  ({ series: { id: 6, name: series.name, part }, listeners }) as unknown as BookListItem;

beforeEach(() => {
  vi.mocked(getSeries).mockReset().mockResolvedValue(null);
  vi.mocked(listSeriesBooks).mockReset().mockResolvedValue([]);
  vi.mocked(countWaitingLookups).mockReset().mockResolvedValue(0);
});

describe('series page loader', () => {
  it('is a 404 for an unknown or malformed id', async () => {
    await expect(loader(loaderArgs('999'))).rejects.toMatchObject({ init: { status: 404 } });
    await expect(loader(loaderArgs('abc'))).rejects.toMatchObject({ init: { status: 404 } });
    expect(getSeries).toHaveBeenCalledTimes(1);
  });

  it('gives the gaps, the waiting lookups for the series author, and each listener once', async () => {
    const viveca = { id: 48, name: 'Viveca Sten' };
    const other = { id: 50, name: 'Other' };
    vi.mocked(getSeries).mockResolvedValue(series);
    vi.mocked(listSeriesBooks).mockResolvedValue([
      book(1, [viveca]),
      book(3, [viveca, other]),
      book(null, [viveca]),
    ]);
    vi.mocked(countWaitingLookups).mockResolvedValue(2);

    const page = await loader(loaderArgs('6'));

    expect(countWaitingLookups).toHaveBeenCalledWith({}, 'viveca sten');
    expect(page).toMatchObject({ gaps: [2], waiting: 2, listeners: [viveca, other] });
  });
});
