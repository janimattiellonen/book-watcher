import { Form, useLocation } from 'react-router';

import type { BookStatus, ListenerBook } from '../../src/db/books';
import { STATUS_ACTIONS } from '../lib/bookViews';
import { BookCard } from './BookCard';

const BULK_STATUSES: BookStatus[] = ['read', 'accepted', 'rejected'];

/**
 * The books a listener's seed found, each with a checkbox, and one submit per status:
 * however many books are ticked, marking them is one post to `/books/status`.
 */
export function BulkStatusForm({
  books,
  statusLabel,
}: {
  books: ListenerBook[];
  statusLabel: (book: ListenerBook) => string;
}) {
  const location = useLocation();

  return (
    // Keyed by the books' statuses, so a submit that changed them also clears the ticks:
    // a second click must not re-mark the same books by accident.
    <Form
      key={books.map((book) => `${book.id}:${book.status}`).join()}
      method="post"
      action="/books/status"
    >
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
        <label className="mr-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          {/* Needs JavaScript; without it the books are ticked one by one. */}
          <input
            type="checkbox"
            onChange={(event) => {
              const boxes =
                event.currentTarget.form?.querySelectorAll<HTMLInputElement>(
                  'input[name="bookId"]',
                );
              boxes?.forEach((box) => (box.checked = event.currentTarget.checked));
            }}
          />
          Select all
        </label>
        {BULK_STATUSES.map((status) => (
          <button
            key={status}
            type="submit"
            name="status"
            value={status}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {STATUS_ACTIONS[status]}
          </button>
        ))}
      </div>
      {books.map((book) => (
        <div key={book.id} className="flex items-start gap-3">
          <input
            type="checkbox"
            name="bookId"
            value={book.id}
            aria-label={`Select ${book.title}`}
            className="mt-5"
          />
          <div className="min-w-0 flex-1">
            <BookCard book={book} dateLabel={statusLabel(book)} />
          </div>
        </div>
      ))}
    </Form>
  );
}
