import { useEffect, useRef, useState } from 'react';
import { Form, useLocation } from 'react-router';

import type { BookStatus, ListenerBook } from '../../src/db/books';
import { STATUS_ACTIONS } from '../lib/bookViews';
import { BookCard } from './BookCard';
import { SeriesGroups } from './SeriesGroups';

const BULK_STATUSES: BookStatus[] = ['read', 'accepted', 'rejected'];

const tickedCount = (form: HTMLFormElement | null) =>
  form?.querySelectorAll('input[name="bookId"]:checked').length ?? 0;

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
  const formKey = books.map((book) => `${book.id}:${book.status}`).join();
  const formRef = useRef<HTMLFormElement>(null);
  // Null until JavaScript runs, so without it the buttons stay usable; the server then
  // treats a submit with nothing ticked as no change.
  const [ticked, setTicked] = useState<number | null>(null);
  useEffect(() => setTicked(tickedCount(formRef.current)), [formKey]);

  return (
    // Keyed by the books' statuses, so a submit that changed them also clears the ticks:
    // a second click must not re-mark the same books by accident.
    <Form
      key={formKey}
      ref={formRef}
      method="post"
      action="/books/status"
      onChange={(event) => setTicked(tickedCount(event.currentTarget))}
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
            disabled={ticked === 0}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {STATUS_ACTIONS[status]}
          </button>
        ))}
      </div>
      {/* Grouped by series, but each book keeps its own checkbox. */}
      <SeriesGroups
        books={books}
        renderBook={(book) => (
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
        )}
      />
    </Form>
  );
}
