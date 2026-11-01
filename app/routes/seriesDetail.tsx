import { data, Link } from 'react-router';

import { listSeriesBooks } from '../../src/db/books';
import { countWaitingLookups, getSeries } from '../../src/db/series';
import { BookCard } from '../components/BookCard';
import { StatusButtons } from '../components/StatusButtons';
import { bookStatusLabel } from '../lib/bookViews';
import { db } from '../lib/db.server';
import { seriesGaps } from '../lib/seriesGaps';
import type { Route } from './+types/seriesDetail';

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.series.name ?? 'Series'} · Book Watcher` }];
}

/** One series: its books in part order, its gaps, and what may still fill them (US-S4). */
export async function loader({ params }: Route.LoaderArgs) {
  const series = /^\d+$/.test(params.id) ? await getSeries(db, Number(params.id)) : null;
  if (!series) throw data('Series not found', { status: 404 });

  const [books, waiting] = await Promise.all([
    listSeriesBooks(db, series.id),
    countWaitingLookups(db, series.authorKey),
  ]);
  const listeners = new Map<number, string>();
  for (const book of books) {
    for (const listener of book.listeners) listeners.set(listener.id, listener.name);
  }
  return {
    series,
    books,
    gaps: seriesGaps(books.map((book) => book.series?.part ?? null)),
    waiting,
    listeners: [...listeners].map(([id, name]) => ({ id, name })),
  };
}

export default function SeriesDetail({ loaderData }: Route.ComponentProps) {
  const { series, books, gaps, waiting, listeners } = loaderData;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {series.name}
        <span className="ml-2 text-base font-normal text-gray-500 dark:text-gray-400">
          {books.length}
        </span>
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        {series.author}
        {listeners.length > 0 ? ' · Found by ' : null}
        {listeners.map((listener, index) => (
          <span key={listener.id}>
            {index > 0 ? ', ' : null}
            <Link to={`/listeners/${listener.id}`} className="hover:underline">
              {listener.name}
            </Link>
          </span>
        ))}
      </p>

      {gaps.length > 0 || waiting > 0 ? (
        <section className="mt-4 rounded border border-gray-200 p-4 text-sm dark:border-gray-800">
          {gaps.length > 0 ? (
            <>
              <ul className="space-y-0.5 text-gray-900 dark:text-gray-100">
                {gaps.map((part) => (
                  <li key={part}>Part {part}: not in Book Watcher</li>
                ))}
              </ul>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Missing parts may not be sold as e-books in this language, may not be out yet, or
                may not be marked with the series in the store.
              </p>
            </>
          ) : null}
          {waiting > 0 ? (
            <p className={gaps.length > 0 ? 'mt-2 text-gray-600 dark:text-gray-400' : undefined}>
              {waiting === 1
                ? '1 book by this author is still waiting for a series lookup.'
                : `${waiting} books by this author are still waiting for a series lookup.`}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-4">
        {books.map((book) => (
          <BookCard key={book.id} book={book} dateLabel={bookStatusLabel(book)}>
            <StatusButtons bookId={book.id} status={book.status} />
          </BookCard>
        ))}
      </div>
    </main>
  );
}
