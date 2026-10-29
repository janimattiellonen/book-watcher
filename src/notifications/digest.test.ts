import { describe, expect, it } from 'vitest';

import type { Offer } from '../db/books';
import { buildDigest } from './digest';

const bokus = (price: number, url: string): Offer => ({
  source: 'bokus',
  url,
  price,
  currency: 'SEK',
  priceEur: Math.round(price * 0.087 * 100) / 100,
});
const adlibris = (price: number, url: string): Offer => ({
  source: 'adlibris',
  url,
  price,
  currency: 'EUR',
  priceEur: price,
});

const books = [
  {
    title: 'Ö-titel',
    authors: ['Viveca Sten'],
    offers: [bokus(59, 'https://www.bokus.com/bok/1/')],
  },
  {
    title: 'Kvinnorna på Ensamheten',
    authors: ['Heikki Hietala'],
    offers: [adlibris(6.99, 'https://www.adlibris.com/fi/kirja/a')],
  },
  {
    title: 'I stundens hetta',
    authors: ['Viveca Sten'],
    offers: [
      adlibris(7.49, 'https://www.adlibris.com/fi/kirja/b'),
      bokus(79, 'https://www.bokus.com/bok/2/'),
    ],
  },
];

describe('buildDigest', () => {
  it('counts the books in the subject', () => {
    expect(buildDigest(books).subject).toBe('Book Watcher: 3 new books');
    expect(buildDigest(books.slice(0, 1)).subject).toBe('Book Watcher: 1 new book');
  });

  it('lists books by author, with the price and link per source and a link to the site', () => {
    expect(buildDigest(books).text).toBe(
      [
        'Heikki Hietala',
        '  Kvinnorna på Ensamheten',
        '    Adlibris: 6.99 €  https://www.adlibris.com/fi/kirja/a',
        '',
        'Viveca Sten',
        '  I stundens hetta',
        '    Adlibris: 7.49 €  https://www.adlibris.com/fi/kirja/b',
        '    Bokus: 79.00 SEK (6.87 €)  https://www.bokus.com/bok/2/',
        '  Ö-titel',
        '    Bokus: 59.00 SEK (5.13 €)  https://www.bokus.com/bok/1/',
        '',
        'Review them at http://localhost:3192',
      ].join('\n'),
    );
  });

  it('escapes store text in the HTML', () => {
    const { html } = buildDigest([
      {
        title: 'Love & <Death>',
        authors: ['A "Quoted" Author'],
        offers: [adlibris(5, 'https://example.com/?a=1&b=2')],
      },
    ]);
    expect(html).toContain('<strong>Love &amp; &lt;Death&gt;</strong>');
    expect(html).toContain('<h3>A &quot;Quoted&quot; Author</h3>');
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2">Adlibris</a>: 5.00 €');
    expect(html).toContain('<a href="http://localhost:3192">');
  });
});
