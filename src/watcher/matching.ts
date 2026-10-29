import type { SearchResult } from '../sources/types.js';

/** The parts of a listener that decide whether a search result is wanted. */
export interface ListenerCriteria {
  author: string;
  language: string;
  format: string;
  minPriceEur: number | null;
  maxPriceEur: number | null;
}

/**
 * Normalizes a person's name for comparison: case, diacritics, punctuation and
 * whitespace are ignored, and "Sten, Viveca" reads as "viveca sten".
 */
export function normalizeName(name: string): string {
  const [last, ...rest] = name.split(',');
  const ordered = rest.length === 1 ? `${rest[0]} ${last}` : name;
  return normalizeText(ordered);
}

/** Lowercase, without diacritics or punctuation, with single spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True when one of the book's authors is the listener's author. The match is on the
 * whole normalized name, so "Camilla Sten", "Viveca Stenberg" or a book that merely
 * mentions the author do not count.
 */
export function matchesAuthor(listenerAuthor: string, authors: readonly string[]): boolean {
  const wanted = normalizeName(listenerAuthor);
  return authors.some((author) => normalizeName(author) === wanted);
}

/** An ISBN-13 without hyphens or spaces, or null if the input isn't one. */
export function normalizeIsbn(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[\s-]/g, '');
  return /^97[89]\d{10}$/.test(digits) ? digits : null;
}

/**
 * The key that makes one book a single row however many sources list it: the ISBN
 * when there is one, otherwise authors, title and format.
 */
export function dedupeKey(result: Pick<SearchResult, 'isbn' | 'authors' | 'title' | 'format'>) {
  const isbn = normalizeIsbn(result.isbn);
  if (isbn) return `isbn:${isbn}`;
  const authors = result.authors.map(normalizeName).sort().join(',');
  return `ta:${authors}|${normalizeText(result.title)}|${result.format}`;
}

/** A price in euros, rounded to cents. */
export function toEur(
  price: number | null,
  currency: SearchResult['currency'],
  sekToEur: number,
): number | null {
  if (price === null) return null;
  const eur = currency === 'SEK' ? price * sekToEur : price;
  return Math.round(eur * 100) / 100;
}

/**
 * Whether a price is within a range whose bounds are inclusive and may be open
 * (null). An unknown price only fits a range with no bounds at all.
 */
export function inPriceRange(
  priceEur: number | null,
  minPriceEur: number | null,
  maxPriceEur: number | null,
): boolean {
  if (priceEur === null) return minPriceEur === null && maxPriceEur === null;
  return (
    (minPriceEur === null || priceEur >= minPriceEur) &&
    (maxPriceEur === null || priceEur <= maxPriceEur)
  );
}

/** Author, format and language: whether the book is one the listener is after at all. */
export function isListenersBook(listener: ListenerCriteria, result: SearchResult): boolean {
  return (
    matchesAuthor(listener.author, result.authors) &&
    result.format === listener.format &&
    // Adlibris cards don't state a language; its search URL already filtered by it.
    (result.language === null || result.language === listener.language)
  );
}

/** Whether a book is the listener's and, at its current price, worth suggesting. */
export function matchesListener(
  listener: ListenerCriteria,
  result: SearchResult,
  sekToEur: number,
): boolean {
  return (
    isListenersBook(listener, result) &&
    inPriceRange(
      toEur(result.price, result.currency, sekToEur),
      listener.minPriceEur,
      listener.maxPriceEur,
    )
  );
}
