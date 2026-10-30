import type { ReactNode } from 'react';

import type { BookListItem } from '../../src/db/books';
import { formatPrice } from '../../src/notifications/digest';
import { SOURCE_LABELS } from '../../src/sources/types';

const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

/**
 * One book: cover, title, authors, a price and link per store, and the listeners that
 * found it. A book sold by both stores is one card with two offers. `children` holds
 * the card's controls.
 */
export function BookCard({
  book,
  dateLabel,
  children,
}: {
  book: BookListItem;
  /** E.g. "Found 29 Oct 2026". */
  dateLabel: string | null;
  children?: ReactNode;
}) {
  return (
    <article className="flex gap-4 border-b border-gray-100 py-4 dark:border-gray-900">
      <div className="h-28 w-20 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-medium text-gray-900 dark:text-gray-100">{book.title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{book.authors.join(', ')}</p>
        <ul className="mt-1 space-y-0.5 text-sm">
          {book.offers.map((offer) => (
            <li key={offer.source}>
              <a
                href={offer.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {SOURCE_LABELS[offer.source]}
              </a>
              <span className="text-gray-900 dark:text-gray-100">: {formatPrice(offer)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {[
            book.listeners.length > 0 ? book.listeners.map((l) => l.name).join(', ') : null,
            book.publishedDate ? `Published ${date.format(new Date(book.publishedDate))}` : null,
            dateLabel,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </article>
  );
}

export const formatDate = (value: Date) => date.format(value);
