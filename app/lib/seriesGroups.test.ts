import { describe, expect, it } from 'vitest';

import { groupBySeries, partLabel } from './seriesGroups';

const sandhamn = { id: 1, name: 'Morden i Sandhamn' };
const are = { id: 2, name: 'Åremorden' };

const book = (
  title: string,
  series?: { id: number; name: string },
  part: number | null = null,
) => ({
  title,
  series: series ? { ...series, part } : null,
});

/** The grouped list as titles: a series is `name: [titles]`. */
const shape = (books: ReturnType<typeof book>[]) =>
  groupBySeries(books).map((item) =>
    item.kind === 'book' ? item.book.title : { [item.series.name]: item.books.map((b) => b.title) },
  );

describe('groupBySeries', () => {
  it('puts a group where its first member was, and leaves other books in place', () => {
    expect(
      shape([
        book('Helenas resa'),
        book('Sandhamn 3', sandhamn, 3),
        book('Åre 1', are, 1),
        book('Återträffen'),
        book('Sandhamn 1', sandhamn, 1),
        book('Åre 2', are, 2),
      ]),
    ).toEqual([
      'Helenas resa',
      { 'Morden i Sandhamn': ['Sandhamn 1', 'Sandhamn 3'] },
      { Åremorden: ['Åre 1', 'Åre 2'] },
      'Återträffen',
    ]);
  });

  it('orders a group by part, also past part 9 and between parts', () => {
    expect(
      shape([
        book('Ten', sandhamn, 10),
        book('Two', sandhamn, 2),
        book('Two and a half', sandhamn, 2.5),
      ]),
    ).toEqual([{ 'Morden i Sandhamn': ['Two', 'Two and a half', 'Ten'] }]);
  });

  it('puts books without a part last, by title', () => {
    expect(
      shape([
        book('b', sandhamn),
        book('Five', sandhamn, 5),
        book('A', sandhamn),
        book('One', sandhamn, 1),
      ]),
    ).toEqual([{ 'Morden i Sandhamn': ['One', 'Five', 'A', 'b'] }]);
  });

  it('leaves a book alone when no other book of its series is in the list', () => {
    expect(shape([book('Åre 4', are, 4), book('Sandhamn 1', sandhamn, 1)])).toEqual([
      'Åre 4',
      'Sandhamn 1',
    ]);
    expect(shape([])).toEqual([]);
  });
});

describe('partLabel', () => {
  it('names the part, or nothing without one', () => {
    expect(partLabel(3)).toBe('Part 3');
    expect(partLabel(2.5)).toBe('Part 2.5');
    expect(partLabel(null)).toBeNull();
  });
});
