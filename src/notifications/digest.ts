import type { BookListItem, Offer } from '../db/books.js';
import { SOURCE_LABELS } from '../sources/types.js';
import type { Email } from './mailer.js';

export const SITE_URL = 'http://localhost:3192';

type DigestBook = Pick<BookListItem, 'title' | 'authors' | 'offers'>;

/** The offer's price, with the euro conversion for a SEK price. Also used by the book cards. */
export function formatPrice(offer: Offer): string {
  if (offer.price === null) return 'price unknown';
  const original = `${offer.price.toFixed(2)} ${offer.currency === 'EUR' ? '€' : (offer.currency ?? '')}`;
  return offer.currency === 'EUR' || offer.priceEur === null
    ? original.trim()
    : `${original} (${offer.priceEur.toFixed(2)} €)`;
}

/** Books grouped by their author list, authors and titles in alphabetical order. */
function groupByAuthor(books: readonly DigestBook[]): [string, DigestBook[]][] {
  const groups = new Map<string, DigestBook[]>();
  for (const book of books) {
    const author = book.authors.join(', ');
    groups.set(author, [...(groups.get(author) ?? []), book]);
  }
  const compare = (a: string, b: string) => a.localeCompare(b, 'fi');
  return [...groups.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([author, group]) => [author, group.sort((a, b) => compare(a.title, b.title))]);
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

/** The daily digest of queued books: subject, plain text and HTML, grouped by author. */
export function buildDigest(books: readonly DigestBook[]): Email {
  const count = books.length;
  const subject = `Book Watcher: ${count} new ${count === 1 ? 'book' : 'books'}`;
  const groups = groupByAuthor(books);

  const text = [
    ...groups.flatMap(([author, group]) => [
      author,
      ...group.flatMap((book) => [
        `  ${book.title}`,
        ...book.offers.map(
          (offer) => `    ${SOURCE_LABELS[offer.source]}: ${formatPrice(offer)}  ${offer.url}`,
        ),
      ]),
      '',
    ]),
    `Review them at ${SITE_URL}`,
  ].join('\n');

  const html = [
    `<h2>${escapeHtml(subject)}</h2>`,
    ...groups.flatMap(([author, group]) => [
      `<h3>${escapeHtml(author)}</h3>`,
      '<ul>',
      ...group.map(
        (book) =>
          `<li><strong>${escapeHtml(book.title)}</strong><br>` +
          book.offers
            .map(
              (offer) =>
                `<a href="${escapeHtml(offer.url)}">${SOURCE_LABELS[offer.source]}</a>: ${escapeHtml(formatPrice(offer))}`,
            )
            .join('<br>') +
          '</li>',
      ),
      '</ul>',
    ]),
    `<p><a href="${SITE_URL}">Review them in Book Watcher</a></p>`,
  ].join('\n');

  return { subject, text, html };
}
