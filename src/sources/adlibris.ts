import * as cheerio from 'cheerio';

import {
  assertNotBlocked,
  cleanText,
  isbnFrom,
  parseCount,
  parsePrice,
  validateResults,
} from './parsing.js';
import { type Format, type ParsedPage, type SearchQuery, UnexpectedPageError } from './types.js';

export const ADLIBRIS_ORIGIN = 'https://www.adlibris.com';

/** Values of the Finnish site's `language` refinement, keyed by our normalized language code. */
const LANGUAGE_FACETS: Record<string, string> = { fi: 'suomi', sv: 'ruotsi', en: 'englanti' };

/** Values of the Finnish site's `format` refinement. */
const FORMAT_FACETS: Record<Format, string> = { ebook: 'E-kirja' };

/** Format labels on result cards, mapped to our normalized formats. */
const FORMAT_LABELS: Record<string, Format> = { 'E-kirja': 'ebook' };

export function adlibrisSearchUrl(query: SearchQuery): string {
  const languageFacet = LANGUAGE_FACETS[query.language];
  if (!languageFacet) {
    throw new Error(`Adlibris has no language refinement for "${query.language}"`);
  }
  const url = new URL('/fi/haku', ADLIBRIS_ORIGIN);
  url.searchParams.set('refinementList[language][0]', languageFacet);
  url.searchParams.set('refinementList[format][0]', FORMAT_FACETS[query.format]);
  url.searchParams.set('q', query.author);
  return url.toString();
}

/**
 * Reads an Adlibris (Finnish site) search results page.
 *
 * Each product is an `<article>`. Cards don't state the language, so results carry
 * `language: null` and rely on the search URL's language refinement.
 */
export function parseAdlibris(html: string): ParsedPage {
  assertNotBlocked(html);
  const $ = cheerio.load(html);

  const countMatch = /(\d[\d\s]*)(?:<!-- -->)?\s*osuma/.exec(html);
  const searchInput = $('[data-testid="search-input"]');
  if (!countMatch && searchInput.length === 0) {
    throw new UnexpectedPageError('No Adlibris hit count or search field on the page');
  }

  const results = $('article')
    .toArray()
    .map((element) => {
      const card = $(element);
      const link = card.find('a[href*="/fi/"]').first();
      const href = link.attr('href');
      const heading = card.find('h3').first();
      // The title is followed by the author(s), then the format with its icon.
      const details = heading.nextAll('span').toArray();
      const formatSpan = details.find((span) => $(span).find('svg').length > 0);
      const formatText = formatSpan ? cleanText($(formatSpan).text()) : '';
      const priceText = card
        .find('span')
        .filter((_, span) => $(span).children('span').text().trim() === '€')
        .first()
        .text();

      return {
        source: 'adlibris',
        title: cleanText(heading.text()),
        authors: details
          .filter((span) => span !== formatSpan)
          .flatMap((span) => cleanText($(span).text()).split(/\s*,\s*/))
          .filter(Boolean),
        isbn: isbnFrom(href),
        format: FORMAT_LABELS[formatText] ?? (formatText || 'unknown'),
        language: null,
        price: priceText ? parsePrice(priceText) : null,
        currency: 'EUR',
        url: new URL(href ?? '', ADLIBRIS_ORIGIN).toString(),
        coverUrl: coverUrl(card.find('img').first().attr('src')),
      };
    });

  return {
    results: validateResults(results),
    totalCount: countMatch ? parseCount(countMatch[1]) : null,
    hasMore: false,
  };
}

/** Unwraps Next.js image proxy URLs (`/_next/image?url=...`) to the original image. */
function coverUrl(src: string | undefined): string | null {
  if (!src) return null;
  const url = new URL(src, ADLIBRIS_ORIGIN);
  return url.pathname === '/_next/image' ? url.searchParams.get('url') : url.toString();
}
