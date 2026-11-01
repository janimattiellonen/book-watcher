import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { adlibrisBookSchema, parseAdlibrisBook } from './adlibrisBook.js';
import { BlockedError, UnexpectedPageError } from './types.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/adlibris/${name}`, import.meta.url), 'utf8');

describe('parseAdlibrisBook', () => {
  it('reads the series and part of the first book of a series', () => {
    expect(parseAdlibrisBook(fixture('book-hildur.html'))).toEqual({
      isbn: '9789137506579',
      series: { name: 'Hildur-serien', part: 1 },
    });
  });

  it('reads a later part', () => {
    expect(parseAdlibrisBook(fixture('book-tinna.html'))).toEqual({
      isbn: '9789137164328',
      series: { name: 'Hildur-serien', part: 5 },
    });
  });

  it('gives no series for a book that is not in one', () => {
    expect(parseAdlibrisBook(fixture('book-janiksen-vuosi.html'))).toEqual({
      isbn: '9789510394595',
      series: null,
    });
  });

  it('throws BlockedError on the security checkpoint page', () => {
    expect(() => parseAdlibrisBook(fixture('checkpoint-curl-429.html'))).toThrow(BlockedError);
  });

  it('throws on a page that is not a book page', () => {
    expect(() => parseAdlibrisBook(fixture('search-heikki-hietala-fi-ebook.html'))).toThrow(
      UnexpectedPageError,
    );
  });
});

describe('adlibrisBookSchema', () => {
  it('accepts what the parser gives for the fixtures', () => {
    for (const name of ['book-hildur.html', 'book-tinna.html', 'book-janiksen-vuosi.html']) {
      expect(adlibrisBookSchema.safeParse(parseAdlibrisBook(fixture(name))).success).toBe(true);
    }
  });

  it('rejects a book page that is not shaped as the lookup needs', () => {
    const bad = [
      { isbn: '123', series: null },
      { isbn: null, series: { name: '', part: 1 } },
      { isbn: null, series: { name: 'Hildur-serien', part: -1 } },
    ];
    for (const book of bad) expect(adlibrisBookSchema.safeParse(book).success).toBe(false);
  });
});
