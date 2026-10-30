import { Link } from 'react-router';

import { listRecentRuns, type Run } from '../../src/db/runs';
import { db } from '../lib/db.server';
import { SOURCE_LABELS } from '../lib/listenerSchema';
import type { Route } from './+types/runs';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Runs · Book Watcher' }];
}

const RUN_LIMIT = 100;

export async function loader() {
  return { runs: await listRecentRuns(db, { limit: RUN_LIMIT }) };
}

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function duration(run: Run): string {
  if (!run.finishedAt) return '–';
  const seconds = Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Failed and suspicious runs stand out: they mean a store is blocking us or changed. */
const ROW_CLASS: Record<Run['status'], string> = {
  ok: '',
  running: 'text-gray-500 dark:text-gray-400',
  failed: 'bg-red-50 dark:bg-red-950/40',
  suspicious: 'bg-amber-50 dark:bg-amber-950/40',
};

const STATUS_CLASS: Record<Run['status'], string> = {
  ok: 'text-green-700 dark:text-green-400',
  running: '',
  failed: 'font-medium text-red-700 dark:text-red-400',
  suspicious: 'font-medium text-amber-700 dark:text-amber-400',
};

const count = (value: number | null) => (value === null ? '–' : value);

export default function Runs({ loaderData }: Route.ComponentProps) {
  const { runs } = loaderData;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Runs</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        The latest {RUN_LIMIT} searches, one per listener and store. A suspicious run found nothing
        where earlier searches found books, which usually means the store blocked us or changed its
        pages.
      </p>

      {runs.length === 0 ? (
        <p className="mt-6 text-gray-600 dark:text-gray-400">No runs yet.</p>
      ) : (
        <table className="mt-6 w-full text-left text-sm text-gray-900 dark:text-gray-100">
          <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <tr>
              <th className="py-2 pr-4 font-medium">Started</th>
              <th className="py-2 pr-4 font-medium">Listener</th>
              <th className="py-2 pr-4 font-medium">Store</th>
              <th className="py-2 pr-4 font-medium">Kind</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 text-right font-medium">Results</th>
              <th className="py-2 pr-4 text-right font-medium">New</th>
              <th className="py-2 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                className={`border-b border-gray-100 align-top dark:border-gray-900 ${ROW_CLASS[run.status]}`}
              >
                <td className="py-2 pr-4 whitespace-nowrap">{dateTime.format(run.startedAt)}</td>
                <td className="py-2 pr-4">
                  {run.listenerId !== null ? (
                    <Link
                      to={`/listeners/${run.listenerId}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {run.listenerName}
                    </Link>
                  ) : (
                    <span className="text-gray-500">Deleted listener</span>
                  )}
                </td>
                <td className="py-2 pr-4">{SOURCE_LABELS[run.source]}</td>
                <td className="py-2 pr-4">{run.kind}</td>
                <td className="py-2 pr-4">
                  <span className={STATUS_CLASS[run.status]}>{run.status}</span>
                  {run.error ? (
                    <p className="mt-1 text-xs break-words text-red-700 dark:text-red-400">
                      {run.error}
                    </p>
                  ) : null}
                </td>
                <td className="py-2 pr-4 text-right">{count(run.results)}</td>
                <td className="py-2 pr-4 text-right">{count(run.newBooks)}</td>
                <td className="py-2 whitespace-nowrap">{duration(run)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
