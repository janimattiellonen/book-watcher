import { Link } from 'react-router';

import { listSeries } from '../../src/db/series';
import { BOOK_VIEWS } from '../lib/bookViews';
import { db } from '../lib/db.server';
import type { Route } from './+types/series';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Series · Book Watcher' }];
}

/** Every series with books, by name (series spec US-S5). */
export async function loader() {
  return { series: await listSeries(db) };
}

export default function SeriesList({ loaderData }: Route.ComponentProps) {
  const { series } = loaderData;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        Series
        <span className="ml-2 text-base font-normal text-gray-500 dark:text-gray-400">
          {series.length}
        </span>
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        The series your books belong to, as the stores name them, with their books counted per page.
      </p>

      {series.length === 0 ? (
        <p className="mt-6 text-gray-600 dark:text-gray-400">
          No series yet. Books get their series when a listener runs.
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm text-gray-900 dark:text-gray-100">
          <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <tr>
              <th className="py-2 pr-4 font-medium">Series</th>
              <th className="py-2 pr-4 font-medium">Author</th>
              {BOOK_VIEWS.map((view) => (
                <th key={view.status} className="py-2 pr-4 text-right font-medium">
                  {view.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 dark:border-gray-900">
                <td className="py-2 pr-4">
                  <Link
                    to={`/series/${s.id}`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {s.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{s.author}</td>
                {BOOK_VIEWS.map((view) => (
                  <td key={view.status} className="py-2 pr-4 text-right">
                    {s.counts[view.status] || '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
