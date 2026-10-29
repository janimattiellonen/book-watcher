import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { adlibrisSearchUrl, parseAdlibris } from './adlibris.js';
import { BlockedError, UnexpectedPageError } from './types.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/adlibris/${name}`, import.meta.url), 'utf8');

describe('adlibrisSearchUrl', () => {
  it('builds the Finnish e-book search', () => {
    expect(adlibrisSearchUrl({ author: 'Heikki Hietala', language: 'fi', format: 'ebook' })).toBe(
      'https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=Heikki+Hietala',
    );
  });

  it('refuses a language it has no refinement for', () => {
    expect(() => adlibrisSearchUrl({ author: 'X', language: 'xx', format: 'ebook' })).toThrow(/xx/);
  });
});

describe('parseAdlibris', () => {
  describe('Heikki Hietala, Finnish e-books', () => {
    const page = parseAdlibris(fixture('search-heikki-hietala-fi-ebook.html'));

    it('reads every card the page reports', () => {
      expect(page.totalCount).toBe(4);
      expect(page.results).toHaveLength(4);
    });

    it('reads a card completely', () => {
      expect(page.results[0]).toEqual({
        source: 'adlibris',
        title: 'Tuhkat',
        authors: ['Heikki Hietala'],
        isbn: '9789527343944',
        format: 'ebook',
        language: null,
        price: 16.6,
        currency: 'EUR',
        url: 'https://www.adlibris.com/fi/kirja/tuhkat-9789527343944',
        coverUrl: 'https://media.adlibris.com/images/9789527343944/tuhkat.jpg',
      });
    });

    it('reads decimal euro prices', () => {
      expect(page.results.map((result) => result.price)).toEqual([16.6, 21.6, 18, 7.3]);
    });
  });

  describe('Arto Paasilinna, a list longer than one page', () => {
    it('reports more results on the first page', () => {
      const page = parseAdlibris(fixture('search-arto-paasilinna-fi-ebook.html'));
      expect(page.totalCount).toBe(54);
      expect(page.results).toHaveLength(24);
      expect(page.hasMore).toBe(true);
    });

    it('reads every card loaded so far after "load more"', () => {
      const page = parseAdlibris(fixture('search-arto-paasilinna-fi-ebook-more-1.html'));
      expect(page.results).toHaveLength(48);
      expect(new Set(page.results.map((result) => result.isbn)).size).toBe(48);
      expect(page.hasMore).toBe(true);
    });

    it('splits several comma-separated authors on one card', () => {
      const page = parseAdlibris(fixture('search-arto-paasilinna-fi-ebook-more-1.html'));
      const card = page.results.find((result) => result.title === 'Antti Tapani');
      expect(card?.authors).toEqual(['Antti Tuisku', 'Antti Aro', 'Anton Vanha-Majamaa']);
    });

    it('keeps results by other authors for the matcher to filter out', () => {
      const page = parseAdlibris(fixture('search-arto-paasilinna-fi-ebook.html'));
      const authors = new Set(page.results.flatMap((result) => result.authors));
      expect(authors).toContain('Arto Paasilinna');
      expect(authors.size).toBeGreaterThan(1);
    });
  });

  it('reads a search without hits as zero results', () => {
    expect(parseAdlibris(fixture('search-empty.html'))).toEqual({
      results: [],
      totalCount: 0,
      hasMore: false,
    });
  });

  it('refuses a page read before the language and format filters were applied', () => {
    const unfiltered = fixture('search-heikki-hietala-fi-ebook.html').replace(
      'Suodata (2)',
      'Suodata',
    );
    expect(() => parseAdlibris(unfiltered)).toThrow(/filters are not applied/);
  });

  it('gets the same results whichever way the space in the query is encoded', () => {
    const titles = (name: string) =>
      parseAdlibris(fixture(name)).results.map((result) => result.title);
    expect(titles('search-heikki-hietala-poc-url.html')).toEqual(
      titles('search-heikki-hietala-builder-url.html'),
    );
  });

  it('throws BlockedError on the security checkpoint page', () => {
    expect(() => parseAdlibris(fixture('checkpoint-curl-429.html'))).toThrow(BlockedError);
  });

  it('throws on a page that is not a search results page', () => {
    expect(() => parseAdlibris('<html><head><title>x</title></head><body></body></html>')).toThrow(
      UnexpectedPageError,
    );
  });
});
