import { data, Form } from 'react-router';

import { listBooks } from '../../src/db/books';
import { listListeners } from '../../src/db/listeners';
import { BookCard, formatDate } from '../components/BookCard';
import { StatusButtons } from '../components/StatusButtons';
import { parseListenerFilter, viewForParam } from '../lib/bookViews';
import { db } from '../lib/db.server';
import type { Route } from './+types/books';

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.view.title} · Book Watcher` : 'Book Watcher' }];
}

/** Serves Suggestions, Reading list, Read and Rejected; the `:view` param picks the status. */
export async function loader({ params, request }: Route.LoaderArgs) {
  const view = viewForParam(params.view);
  if (!view) throw data('Not found', { status: 404 });

  const listenerId = parseListenerFilter(new URL(request.url).searchParams);
  const [books, listeners] = await Promise.all([
    listBooks(db, { status: view.status, listenerId }),
    listListeners(db),
  ]);
  return { view, books, listeners, listenerId: listenerId ?? null };
}

export default function Books({ loaderData }: Route.ComponentProps) {
  const { view, books, listeners, listenerId } = loaderData;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {view.title}
          <span className="ml-2 text-base font-normal text-gray-500 dark:text-gray-400">
            {books.length}
          </span>
        </h1>
        {/* A GET form, so the filter is in the URL and works without JavaScript. */}
        <Form method="get" className="flex items-center gap-2 text-sm">
          <label htmlFor="listener" className="text-gray-700 dark:text-gray-300">
            Listener
          </label>
          <select
            id="listener"
            name="listener"
            defaultValue={listenerId ?? ''}
            key={listenerId ?? ''}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">All listeners</option>
            {listeners.map((listener) => (
              <option key={listener.id} value={listener.id}>
                {listener.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Filter
          </button>
        </Form>
      </div>

      {books.length === 0 ? (
        <p className="mt-6 text-gray-600 dark:text-gray-400">
          {listenerId === null ? view.empty : 'No books from this listener here.'}
        </p>
      ) : (
        <div className="mt-4">
          {books.map((book) => {
            const at = view.status === 'new' ? book.eligibleAt : book.statusChangedAt;
            const verb = view.status === 'new' ? 'Found' : 'Moved here';
            return (
              <BookCard
                key={book.id}
                book={book}
                dateLabel={at ? `${verb} ${formatDate(at)}` : null}
              >
                <StatusButtons bookId={book.id} status={book.status} />
              </BookCard>
            );
          })}
        </div>
      )}
    </main>
  );
}
