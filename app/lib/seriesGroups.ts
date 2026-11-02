import type { BookSeries } from '../../src/db/books';

interface SeriesBook {
  title: string;
  series: BookSeries | null;
}

/** One entry of a grouped view: a book on its own, or the view's books of one series. */
export type SeriesItem<T> =
  { kind: 'book'; book: T } | { kind: 'series'; series: { id: number; name: string }; books: T[] };

/**
 * Groups an ordered book list by series (series spec US-S3). A group takes the place of
 * its first member, so the list's order still decides where it sits; within it, books
 * go last part first, since the latest parts are the interesting ones, and books
 * without a part last, by title. A book whose series has no other book in the list
 * stays on its own, like a book without a series.
 */
export function groupBySeries<T extends SeriesBook>(books: T[]): SeriesItem<T>[] {
  const counts = new Map<number, number>();
  for (const book of books) {
    if (book.series) counts.set(book.series.id, (counts.get(book.series.id) ?? 0) + 1);
  }

  const items: SeriesItem<T>[] = [];
  const groups = new Map<number, T[]>();
  for (const book of books) {
    const series = book.series;
    if (!series || (counts.get(series.id) ?? 0) < 2) {
      items.push({ kind: 'book', book });
      continue;
    }
    let group = groups.get(series.id);
    if (!group) {
      group = [];
      groups.set(series.id, group);
      items.push({ kind: 'series', series: { id: series.id, name: series.name }, books: group });
    }
    group.push(book);
  }

  for (const group of groups.values()) group.sort(byPart);
  return items;
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });

function byPart(a: SeriesBook, b: SeriesBook): number {
  const partA = a.series?.part ?? null;
  const partB = b.series?.part ?? null;
  if (partA !== partB) {
    if (partA === null) return 1;
    if (partB === null) return -1;
    return partB - partA;
  }
  return collator.compare(a.title, b.title);
}

/** "Part 3" for a book's place in its series; null when the store gave no part. */
export const partLabel = (part: number | null) => (part === null ? null : `Part ${part}`);
