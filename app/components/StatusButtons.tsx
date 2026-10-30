import { Form, useLocation } from 'react-router';

import { BOOK_STATUSES, type BookStatus } from '../../src/db/books';
import { STATUS_ACTIONS } from '../lib/bookViews';

/** One button per status the book is not in; each posts to `/books/status`. */
export function StatusButtons({ bookId, status }: { bookId: number; status: BookStatus }) {
  const location = useLocation();

  return (
    <Form method="post" action="/books/status" className="flex flex-wrap gap-2">
      <input type="hidden" name="bookId" value={bookId} />
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      {BOOK_STATUSES.filter((target) => target !== status).map((target) => (
        <button
          key={target}
          type="submit"
          name="status"
          value={target}
          className={
            target === 'rejected'
              ? 'rounded border border-gray-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-gray-700 dark:text-red-400 dark:hover:bg-red-950'
              : 'rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
          }
        >
          {STATUS_ACTIONS[target]}
        </button>
      ))}
    </Form>
  );
}
