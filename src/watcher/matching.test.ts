import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseBokus } from '../sources/bokus.js';
import type { SearchResult } from '../sources/types.js';
import {
  dedupeKey,
  inPriceRange,
  isListenersBook,
  type ListenerCriteria,
  matchesAuthor,
  matchesListener,
  normalizeIsbn,
  normalizeName,
  toEur,
} from './matching.js';

const SEK_TO_EUR = 0.087;

const listener: ListenerCriteria = {
  author: 'Viveca Sten',
  language: 'sv',
  format: 'ebook',
  minPriceEur: null,
  maxPriceEur: null,
};

const book = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  source: 'bokus',
  title: 'I stundens hetta',
  authors: ['Viveca Sten'],
  isbn: '9789137138466',
  format: 'ebook',
  language: 'sv',
  price: 79,
  currency: 'SEK',
  url: 'https://www.bokus.com/bok/9789137138466/i-stundens-hetta',
  coverUrl: null,
  ...overrides,
});

describe('normalizeName', () => {
  it.each([
    ['Viveca Sten', 'viveca sten'],
    ['  VIVECA   sten ', 'viveca sten'],
    ['Sten, Viveca', 'viveca sten'],
    ['Viveca Lärn', 'viveca larn'],
    ['J. K. Tamminen', 'j k tamminen'],
    ['Marja-Leena Tiainen', 'marja leena tiainen'],
  ])('reads %j as %j', (name, expected) => {
    expect(normalizeName(name)).toBe(expected);
  });
});

describe('matchesAuthor', () => {
  it('matches regardless of case, diacritics and name order', () => {
    expect(matchesAuthor('Viveca Sten', ['sten, viveca'])).toBe(true);
    expect(matchesAuthor('Viveca Larn', ['Viveca Lärn'])).toBe(true);
  });

  it('matches when the author is one of several', () => {
    expect(matchesAuthor('Viveca Sten', ['Camilla Sten', 'Viveca Sten'])).toBe(true);
  });

  it('does not match other people with a shared name', () => {
    expect(matchesAuthor('Viveca Sten', ['Camilla Sten'])).toBe(false);
    expect(matchesAuthor('Viveca Sten', ['Viveca Stenberg'])).toBe(false);
    expect(matchesAuthor('Viveca Sten', ['Viveca Lärn'])).toBe(false);
  });

  it('does not match a book with no authors', () => {
    expect(matchesAuthor('Viveca Sten', [])).toBe(false);
  });
});

describe('normalizeIsbn', () => {
  it('strips hyphens and spaces', () => {
    expect(normalizeIsbn('978-91-371-3846-6')).toBe('9789137138466');
    expect(normalizeIsbn('978 9137138466')).toBe('9789137138466');
  });

  it('rejects anything that is not an ISBN-13', () => {
    expect(normalizeIsbn('91-371-3846-X')).toBeNull();
    expect(normalizeIsbn('1234567890123')).toBeNull();
    expect(normalizeIsbn(null)).toBeNull();
  });
});

describe('dedupeKey', () => {
  it('gives the same key for the same ISBN however it is formatted', () => {
    expect(dedupeKey(book({ isbn: '9789137138466' }))).toBe('isbn:9789137138466');
    expect(dedupeKey(book({ isbn: '978-91-371-3846-6' }))).toBe('isbn:9789137138466');
  });

  it('falls back to authors, title and format without an ISBN', () => {
    const a = dedupeKey(book({ isbn: null, authors: ['Viveca Sten', 'Camilla Sten'] }));
    const b = dedupeKey(book({ isbn: null, authors: ['Sten, Camilla', 'VIVECA STEN'] }));
    expect(a).toBe('ta:camilla sten,viveca sten|i stundens hetta|ebook');
    expect(b).toBe(a);
  });
});

describe('toEur', () => {
  it('converts SEK and rounds to cents', () => {
    expect(toEur(139, 'SEK', SEK_TO_EUR)).toBe(12.09);
  });

  it('keeps EUR as it is', () => {
    expect(toEur(16.6, 'EUR', SEK_TO_EUR)).toBe(16.6);
  });

  it('keeps an unknown price unknown', () => {
    expect(toEur(null, 'SEK', SEK_TO_EUR)).toBeNull();
  });
});

describe('inPriceRange', () => {
  it('includes both bounds', () => {
    expect(inPriceRange(5, 5, 10)).toBe(true);
    expect(inPriceRange(10, 5, 10)).toBe(true);
    expect(inPriceRange(10.01, 5, 10)).toBe(false);
    expect(inPriceRange(4.99, 5, 10)).toBe(false);
  });

  it('treats a null bound as open', () => {
    expect(inPriceRange(1000, 5, null)).toBe(true);
    expect(inPriceRange(0, null, 10)).toBe(true);
    expect(inPriceRange(42, null, null)).toBe(true);
  });

  it('fits an unknown price only into a range without bounds', () => {
    expect(inPriceRange(null, null, null)).toBe(true);
    expect(inPriceRange(null, null, 10)).toBe(false);
  });
});

describe('isListenersBook', () => {
  it('requires the author, format and language', () => {
    expect(isListenersBook(listener, book())).toBe(true);
    expect(isListenersBook(listener, book({ authors: ['Camilla Sten'] }))).toBe(false);
    expect(isListenersBook(listener, book({ format: 'Ljudbok' }))).toBe(false);
    expect(isListenersBook(listener, book({ language: 'en' }))).toBe(false);
  });

  it('accepts a result whose card states no language', () => {
    expect(isListenersBook(listener, book({ language: null }))).toBe(true);
  });
});

describe('matchesListener', () => {
  it('applies the price range to the price in euros', () => {
    // 139 SEK is 12.09 EUR.
    const bounded = { ...listener, maxPriceEur: 12 };
    expect(matchesListener(bounded, book({ price: 139 }), SEK_TO_EUR)).toBe(false);
    expect(matchesListener(bounded, book({ price: 79 }), SEK_TO_EUR)).toBe(true);
  });

  it('keeps only Viveca Sten books from a real Bokus search', () => {
    const fixture = readFileSync(
      new URL('../../tests/fixtures/bokus/search-viveca-sten-sv-ebook.html', import.meta.url),
      'utf8',
    );
    const { results } = parseBokus(fixture);
    const matching = results.filter((result) => matchesListener(listener, result, SEK_TO_EUR));

    expect(matching.length).toBeGreaterThan(0);
    expect(matching.length).toBeLessThan(results.length);
    expect(matching.every((result) => result.authors.includes('Viveca Sten'))).toBe(true);
    expect(
      results
        .filter((result) => !result.authors.includes('Viveca Sten'))
        .some((result) => matching.includes(result)),
    ).toBe(false);
  });
});
