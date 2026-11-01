import type { ReactNode } from 'react';
import { Link } from 'react-router';

import type { BookSeries } from '../../src/db/books';
import { groupBySeries } from '../lib/seriesGroups';

/**
 * An ordered book list, grouped by series (`groupBySeries`): each group under a heading
 * that links to the series page. `renderBook` draws one book, keyed by the caller.
 */
export function SeriesGroups<T extends { id: number; title: string; series: BookSeries | null }>({
  books,
  renderBook,
}: {
  books: T[];
  renderBook: (book: T) => ReactNode;
}) {
  return groupBySeries(books).map((item) =>
    item.kind === 'book' ? (
      renderBook(item.book)
    ) : (
      <section
        key={`series-${item.series.id}`}
        className="mt-4 border-l-2 border-gray-200 pl-4 dark:border-gray-800"
      >
        <h2 className="pt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <Link to={`/series/${item.series.id}`} className="hover:underline">
            {item.series.name}
          </Link>
          <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
            {item.books.length} books
          </span>
        </h2>
        {item.books.map(renderBook)}
      </section>
    ),
  );
}
