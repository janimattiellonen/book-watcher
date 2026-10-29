import { BlockedError, type SearchResult, searchResultSchema } from './types.js';

/**
 * Throws if the HTML is the Vercel bot checkpoint both stores sit behind. Parsers call
 * this first, so a block can never be mistaken for "no results".
 */
export function assertNotBlocked(html: string): void {
  if (/<title>[^<]*Security Checkpoint/i.test(html)) {
    throw new BlockedError('The store answered with its security checkpoint instead of results');
  }
}

/**
 * Reads a price such as "139 kr", "1 299 kr" or "16,60 €" into a number.
 * Spaces (including non-breaking ones) are thousand separators; a comma or a dot
 * followed by one or two digits is the decimal separator.
 */
export function parsePrice(text: string): number | null {
  const match = /\d[\d\s]*(?:[.,]\d{1,2})?/.exec(text);
  if (!match) return null;
  const value = Number(match[0].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Reads a count such as "27 produkter" or "1 204 osumaa". */
export function parseCount(text: string): number | null {
  const match = /\d[\d\s]*/.exec(text);
  return match ? Number(match[0].replace(/\s/g, '')) : null;
}

/** Collapses whitespace, including the non-breaking spaces stores like to use. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The ISBN-13 embedded in a product URL or id, if any. */
export function isbnFrom(text: string | undefined): string | null {
  return /(97[89]\d{10})(?!\d)/.exec(text ?? '')?.[1] ?? null;
}

export function validateResults(results: unknown[]): SearchResult[] {
  return results.map((result, index) => {
    const parsed = searchResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        `Result ${index + 1} failed validation: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}\n${JSON.stringify(result)}`,
      );
    }
    return parsed.data;
  });
}
