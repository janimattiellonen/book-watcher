import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { bokusSearchUrl, parseBokus } from './bokus.js';
import { BlockedError, UnexpectedPageError } from './types.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/bokus/${name}`, import.meta.url), 'utf8');

describe('bokusSearchUrl', () => {
  it('builds the e-book search for a Swedish author', () => {
    expect(bokusSearchUrl({ author: 'Viveca Sten', language: 'sv', format: 'ebook' })).toBe(
      'https://www.bokus.com/search?q=Viveca+Sten&facets=format%3AEBOOK%2ClanguageCodes%3Aswe',
    );
  });

  it('refuses a language Bokus has no facet for', () => {
    expect(() => bokusSearchUrl({ author: 'X', language: 'xx', format: 'ebook' })).toThrow(/xx/);
  });
});

describe('parseBokus', () => {
  describe('Viveca Sten, Swedish e-books', () => {
    const page = parseBokus(fixture('search-viveca-sten-sv-ebook.html'));

    it('reads every card the page reports', () => {
      expect(page.totalCount).toBe(27);
      expect(page.results).toHaveLength(27);
      expect(page.hasMore).toBe(false);
    });

    it('reads a card completely', () => {
      expect(page.results[0]).toEqual({
        source: 'bokus',
        title: 'Fördrivaren',
        authors: ['Viveca Sten'],
        isbn: '9789137161839',
        format: 'ebook',
        language: 'sv',
        price: 139,
        currency: 'SEK',
        url: 'https://www.bokus.com/bok/9789137161839/fordrivaren',
        coverUrl: 'https://image.bokus.com/images2/9789137161839_766',
      });
    });

    it('gives every result an ISBN, a price and a unique URL', () => {
      expect(page.results.every((result) => result.isbn && result.price !== null)).toBe(true);
      expect(new Set(page.results.map((result) => result.url)).size).toBe(27);
    });

    it('keeps results by other authors for the matcher to filter out', () => {
      const authors = new Set(page.results.flatMap((result) => result.authors));
      expect(authors).toContain('Viveca Sten');
      expect(authors).toContain('Camilla Sten');
    });
  });

  it('throws BlockedError on the security checkpoint page', () => {
    expect(() => parseBokus(fixture('checkpoint-curl-429.html'))).toThrow(BlockedError);
  });

  it('throws on a page that is not a search results page', () => {
    expect(() => parseBokus('<html><head><title>Bokus</title></head><body></body></html>')).toThrow(
      UnexpectedPageError,
    );
  });
});
