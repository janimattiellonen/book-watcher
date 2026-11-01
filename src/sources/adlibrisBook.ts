import * as cheerio from 'cheerio';
import type { Browser } from 'playwright';
import { z } from 'zod';

import { newPage, openPage } from './browser.js';
import { assertNotBlocked, cleanText, isbnFrom } from './parsing.js';
import { parseAdlibrisSeriesLabel } from './series.js';
import { UnexpectedPageError } from './types.js';

/**
 * What the series lookup needs from an Adlibris book page. Validated with zod at the
 * parser boundary, like the search results, so a markup change fails loudly.
 */
export const adlibrisBookSchema = z.object({
  /** ISBN-13 from the details list, to check the page is the book that was asked for. */
  isbn: z
    .string()
    .regex(/^97[89]\d{10}$/)
    .nullable(),
  /** Null when the page has no "Sarja" line: a successful lookup that found no series. */
  series: z
    .object({ name: z.string().min(1), part: z.number().nonnegative().nullable() })
    .nullable(),
});
export type AdlibrisBook = z.infer<typeof adlibrisBookSchema>;

/**
 * Reads an Adlibris (Finnish site) book page. The details list holds the series as
 * `<dt>Sarja</dt><dd><a …>Hildur-serien</a> (osa 01)</dd>`, next to "ISBN", "Kieli" and
 * the rest. A page without that list is not a book page.
 */
export function parseAdlibrisBook(html: string): AdlibrisBook {
  assertNotBlocked(html);
  const $ = cheerio.load(html);

  const details = new Map(
    $('dt')
      .toArray()
      .map((dt) => [cleanText($(dt).text()), cleanText($(dt).next('dd').text())] as const),
  );
  if (!details.has('ISBN')) {
    throw new UnexpectedPageError('No details list with an ISBN on the Adlibris book page');
  }

  const seriesLine = details.get('Sarja');
  const parsed = adlibrisBookSchema.safeParse({
    isbn: isbnFrom(details.get('ISBN')),
    series: seriesLine ? parseAdlibrisSeriesLabel(seriesLine) : null,
  });
  if (!parsed.success) {
    throw new Error(
      `The Adlibris book page failed validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/**
 * Loads one Adlibris book page in the given browser and parses it. One real request;
 * the caller is responsible for the polite delay before it.
 */
export async function fetchAdlibrisBook(browser: Browser, url: string): Promise<AdlibrisBook> {
  const page = await newPage(browser, 'fi-FI');
  try {
    await openPage(page, url);
    return parseAdlibrisBook(await page.content());
  } finally {
    await page.context().close();
  }
}
