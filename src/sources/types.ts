import { z } from 'zod';

export const SOURCE_IDS = ['adlibris', 'bokus'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const FORMATS = ['ebook'] as const;
export type Format = (typeof FORMATS)[number];

/** What a listener asks a source for. */
export interface SearchQuery {
  author: string;
  /** Normalized language code: 'fi', 'sv', 'en', ... */
  language: string;
  format: Format;
}

/**
 * One book as a source's search results page shows it. Validated with zod at the
 * parser boundary, so a markup change fails loudly instead of yielding half-empty books.
 */
export const searchResultSchema = z.object({
  source: z.enum(SOURCE_IDS),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)),
  /** ISBN-13, digits only. */
  isbn: z
    .string()
    .regex(/^97[89]\d{10}$/)
    .nullable(),
  /** Normalized format, or the store's own label when it is one we don't handle. */
  format: z.string().min(1),
  /** Normalized language code when the page states it, otherwise null. */
  language: z.string().min(1).nullable(),
  price: z.number().nonnegative().nullable(),
  currency: z.enum(['EUR', 'SEK']),
  url: z.url(),
  coverUrl: z.url().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export interface ParsedPage {
  results: SearchResult[];
  /** Total number of hits the store reports for the search, if it shows one. */
  totalCount: number | null;
  /** Whether the store offers more results than the page currently shows. */
  hasMore: boolean;
}

/** The store served its bot checkpoint instead of search results. */
export class BlockedError extends Error {
  override name = 'BlockedError';
}

/** The page does not look like a search results page at all. */
export class UnexpectedPageError extends Error {
  override name = 'UnexpectedPageError';
}
