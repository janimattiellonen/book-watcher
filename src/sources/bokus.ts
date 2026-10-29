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

export const BOKUS_ORIGIN = 'https://www.bokus.com';

/** Bokus `languageCodes` facet values, keyed by our normalized language code. */
const LANGUAGE_FACETS: Record<string, string> = { sv: 'swe', fi: 'fin', en: 'eng' };

/** Bokus `format` facet values. */
const FORMAT_FACETS: Record<Format, string> = { ebook: 'EBOOK' };

/** Format labels on result cards, mapped to our normalized formats. */
const FORMAT_LABELS: Record<string, Format> = { 'E-bok': 'ebook' };

/** Language names on result cards, mapped to our normalized language codes. */
const LANGUAGE_LABELS: Record<string, string> = {
  Svenska: 'sv',
  Finska: 'fi',
  Engelska: 'en',
};

export function bokusSearchUrl(query: SearchQuery): string {
  const languageFacet = LANGUAGE_FACETS[query.language];
  if (!languageFacet) {
    throw new Error(`Bokus has no language facet for "${query.language}"`);
  }
  const url = new URL('/search', BOKUS_ORIGIN);
  url.searchParams.set('q', query.author);
  url.searchParams.set(
    'facets',
    `format:${FORMAT_FACETS[query.format]},languageCodes:${languageFacet}`,
  );
  return url.toString();
}

/**
 * Reads a Bokus search results page.
 *
 * Bokus renders its results as HTML, one `product-card-buy` article per product. More
 * results load in place through the "Visa N till" button, so a page that has had it
 * clicked holds every card loaded so far.
 */
export function parseBokus(html: string): ParsedPage {
  assertNotBlocked(html);
  const $ = cheerio.load(html);

  const countElement = $('[data-testid="product-count"]').first();
  const list = $('[data-test-id="product-list"]');
  if (countElement.length === 0 && list.length === 0) {
    throw new UnexpectedPageError('No Bokus result count or product list on the page');
  }

  const results = $('article[data-test-id="product-card-buy"]')
    .toArray()
    .map((element) => {
      const card = $(element);
      const href = card.find('a[href^="/bok/"]').first().attr('href');
      const formatLabel = card
        .find('span')
        .filter((_, span) => cleanText($(span).text()) in FORMAT_LABELS)
        .first();
      // The format sits in a row with the language and the year: "E-bok", "Svenska, ", "2026".
      const metaSpans = formatLabel
        .parent()
        .parent()
        .children('span')
        .toArray()
        .map((span) => cleanText($(span).text()).replace(/,$/, ''));
      const languageLabel = metaSpans.find((text) => text in LANGUAGE_LABELS);
      const formatText = cleanText(formatLabel.text());
      const priceText = card.find('.price-large').first().text();
      const cover = card.find('img').first().attr('src');

      return {
        source: 'bokus',
        title: cleanText(card.find('h3').first().text()),
        authors: card
          .find('p.product-list-author a')
          .toArray()
          .map((a) => cleanText($(a).text()))
          .filter(Boolean),
        isbn: isbnFrom(card.attr('data-product-id')) ?? isbnFrom(href),
        format: FORMAT_LABELS[formatText] ?? (formatText || 'unknown'),
        language: languageLabel ? (LANGUAGE_LABELS[languageLabel] ?? null) : null,
        price: priceText ? parsePrice(priceText) : null,
        currency: 'SEK',
        url: new URL(href ?? '', BOKUS_ORIGIN).toString(),
        coverUrl: cover ? new URL(cover, BOKUS_ORIGIN).toString() : null,
      };
    });

  const nextButton = $('[data-test-id="listing-next-page"]').first();

  return {
    results: validateResults(results),
    totalCount: countElement.length > 0 ? parseCount(countElement.text()) : null,
    hasMore: nextButton.length > 0 && nextButton.attr('disabled') === undefined,
  };
}
