import { normalizeName, normalizeText } from '../watcher/matching.js';

/** A book's place in a series, as a store states it. */
export interface SeriesRef {
  /** As the store wrote it, e.g. "Morden i Sandhamn" or "Hildur-serien". */
  name: string;
  /** Null when the store gives the series without a part. */
  part: number | null;
}

/**
 * Reads a Bokus search card's series label: "Del 7 - Åremorden" is part 7 of
 * "Åremorden". Any other non-empty label is taken as a series name without a part.
 * Expects the label's text, entities already decoded (cheerio's `.text()` does that).
 */
export function parseBokusSeriesLabel(label: string): SeriesRef | null {
  const text = label.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const match = /^Del\s+(\d+(?:[.,]\d+)?)\s*[-–]\s*(.+)$/i.exec(text);
  return match ? { name: match[2].trim(), part: parsePart(match[1]) } : { name: text, part: null };
}

/**
 * Reads the series line of an Adlibris book page: "Hildur-serien (osa 01)" is part 1 of
 * "Hildur-serien". A leading "Sarja:" is ignored, and a line without "(osa …)" is a
 * series name without a part.
 */
export function parseAdlibrisSeriesLabel(label: string): SeriesRef | null {
  const text = label
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Sarja\s*:\s*/i, '');
  if (!text) return null;
  const match = /^(.+?)\s*\(\s*osa\s+(\d+(?:[.,]\d+)?)\s*\)$/i.exec(text);
  return match ? { name: match[1].trim(), part: parsePart(match[2]) } : { name: text, part: null };
}

/**
 * The series name as compared across stores (spec decision 3): normalized like other
 * text, without a trailing "serien" or "sarja", so Adlibris's "Hildur-serien" and
 * Bokus's "Hildur" meet. A name that is only that word keeps it.
 */
export function seriesNameKey(name: string): string {
  const key = normalizeText(name);
  return key.replace(/ (?:serien|sarja)$/, '') || key;
}

/**
 * The author half of a series' identity: the book's first author, normalized like the
 * listener's author. Two authors' series of the same name stay apart (decision 3).
 */
export function seriesAuthorKey(authors: readonly string[]): string | null {
  const first = authors.find((author) => author.trim());
  return first ? normalizeName(first) : null;
}

/** "01" is 1, "2,5" is 2.5. */
function parsePart(text: string): number {
  return Number(text.replace(',', '.'));
}
