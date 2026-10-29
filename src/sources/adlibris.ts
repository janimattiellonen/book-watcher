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

/** Label of the "load more" button below the results. */
export const LOAD_MORE_LABEL = 'Lataa lisää';

/**
 * Label of the filter button once the search URL's two refinements (language and
 * format) are active. Adlibris applies them in the browser after the first render, so
 * until this label shows, the page lists the unfiltered search.
 */
export const FILTERS_APPLIED_LABEL = 'Suodata (2)';

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
 *
 * Reads the DOM only. The JSON-LD on the page describes just the organisation and the
 * site search, and the Next.js flight data holds none of the 48 ISBNs on the saved
 * "load more" capture, so neither can supply the product cards.
 */
export function parseAdlibris(html: string): ParsedPage {
  assertNotBlocked(html);
  const $ = cheerio.load(html);

  // The hit count next to the filters ("54 osumaa"), present even when it is 0.
  const hitCount = $('main p')
    .toArray()
    .map((p) => /^(\d[\d\s]*)osumaa$/.exec(cleanText($(p).text())))
    .find(Boolean);
  if (!hitCount) {
    throw new UnexpectedPageError('No Adlibris hit count on the page');
  }
  const filterLabel = cleanText($('[data-testid="filter-header"] button').first().text());
  if (filterLabel !== FILTERS_APPLIED_LABEL) {
    throw new UnexpectedPageError(
      `Adlibris language and format filters are not applied (filter button reads "${filterLabel}")`,
    );
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
    totalCount: parseCount(hitCount[1] ?? ''),
    // Shown below the results only while more remain.
    hasMore: $(`main button:contains("${LOAD_MORE_LABEL}")`).length > 0,
  };
}

/** Unwraps Next.js image proxy URLs (`/_next/image?url=...`) to the original image. */
function coverUrl(src: string | undefined): string | null {
  if (!src) return null;
  const url = new URL(src, ADLIBRIS_ORIGIN);
  return url.pathname === '/_next/image' ? url.searchParams.get('url') : url.toString();
}
