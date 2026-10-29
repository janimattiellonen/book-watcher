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

  it('throws BlockedError on the security checkpoint page', () => {
    expect(() => parseAdlibris(fixture('checkpoint-curl-429.html'))).toThrow(BlockedError);
  });

  it('throws on a page that is not a search results page', () => {
    expect(() => parseAdlibris('<html><head><title>x</title></head><body></body></html>')).toThrow(
      UnexpectedPageError,
    );
  });
});
