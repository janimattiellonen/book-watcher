import { data, Form, Link } from 'react-router';

import { deleteListener, listListeners, setListenerEnabled } from '../../src/db/listeners';
import { averageRunSeconds, lastFinishedAt } from '../../src/db/runs';
import { scheduleCapacity } from '../../src/watcher/capacity';
import { nextExpectedRuns } from '../../src/watcher/schedulePolicy';
import { config } from '../lib/config.server';
import { db } from '../lib/db.server';
import { languageLabel, priceRange } from '../lib/listenerDisplay';
import { SOURCE_LABELS } from '../lib/listenerSchema';
import type { Route } from './+types/listeners';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Listeners · Book Watcher' }];
}

export async function loader() {
  const [listeners, lastRunEndedAt, runSeconds] = await Promise.all([
    listListeners(db),
    lastFinishedAt(db),
    averageRunSeconds(db),
  ]);
  const nextRuns = nextExpectedRuns({ listeners, lastRunEndedAt, now: new Date(), config });
  return {
    listeners,
    nextRuns: Object.fromEntries(nextRuns) as Record<number, Date | undefined>,
    capacity: scheduleCapacity({ listeners, averageRunSeconds: runSeconds, config }),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const id = Number(formData.get('id'));
  if (!Number.isSafeInteger(id)) throw data('Bad listener id', { status: 400 });

  switch (formData.get('intent')) {
    case 'enable':
    case 'disable':
      if (!(await setListenerEnabled(db, id, formData.get('intent') === 'enable'))) {
        throw data('Listener not found', { status: 404 });
      }
      return null;
    case 'delete':
      await deleteListener(db, id);
      return null;
    default:
      throw data('Unknown action', { status: 400 });
  }
}

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** An estimate: the scheduler adds jitter to every gap. */
function nextRunLabel(enabled: boolean, at: Date | undefined): string {
  if (!enabled) return '–';
  return at ? `~${dateTime.format(at)}` : 'Unknown';
}

export default function Listeners({ loaderData }: Route.ComponentProps) {
  const { listeners, nextRuns, capacity } = loaderData;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Listeners</h1>
        <Link
          to="/listeners/new"
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New listener
        </Link>
      </div>

      {capacity.fits ? null : (
        <p
          role="alert"
          className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          The enabled listeners don’t fit into {capacity.intervalMinutes / 60} hours: running each
          once, with the gaps between runs, takes about{' '}
          {Math.round((capacity.cycleMinutes / 60) * 10) / 10} hours. Some listeners will run less
          often than daily. Disable some listeners or shorten <code>MIN_GAP_MINUTES</code>.
        </p>
      )}

      {listeners.length === 0 ? (
        <p className="mt-6 text-gray-600 dark:text-gray-400">
          No listeners yet. Add one to start watching an author.
        </p>
      ) : (
        <table className="mt-6 w-full text-left text-sm text-gray-900 dark:text-gray-100">
          <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <tr>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Author</th>
              <th className="py-2 pr-4 font-medium">Language</th>
              <th className="py-2 pr-4 font-medium">Price</th>
              <th className="py-2 pr-4 font-medium">Sources</th>
              <th className="py-2 pr-4 font-medium">Seed</th>
              <th className="py-2 pr-4 font-medium">Last run</th>
              <th className="py-2 pr-4 font-medium">Next run</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listeners.map((listener) => (
              <tr
                key={listener.id}
                className={`border-b border-gray-100 dark:border-gray-900 ${listener.enabled ? '' : 'text-gray-400 dark:text-gray-600'}`}
              >
                <td className="py-2 pr-4">
                  <Link
                    to={`/listeners/${listener.id}`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {listener.name}
                  </Link>
                  {listener.enabled ? null : <span className="ml-2 text-xs">(disabled)</span>}
                </td>
                <td className="py-2 pr-4">{listener.author}</td>
                <td className="py-2 pr-4">{languageLabel(listener.language)}</td>
                <td className="py-2 pr-4">
                  {priceRange(listener.minPriceEur, listener.maxPriceEur)}
                </td>
                <td className="py-2 pr-4">
                  {listener.sources.map((source) => SOURCE_LABELS[source]).join(', ')}
                </td>
                <td className="py-2 pr-4">{listener.seedState}</td>
                <td className="py-2 pr-4">
                  {listener.lastRunAt ? dateTime.format(listener.lastRunAt) : 'Never'}
                </td>
                <td className="py-2 pr-4">
                  {nextRunLabel(listener.enabled, nextRuns[listener.id])}
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-3">
                    <Link
                      to={`/listeners/${listener.id}/edit`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Edit
                    </Link>
                    <Form method="post">
                      <input type="hidden" name="id" value={listener.id} />
                      <button
                        type="submit"
                        name="intent"
                        value={listener.enabled ? 'disable' : 'enable'}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {listener.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </Form>
                    <Form
                      method="post"
                      onSubmit={(event) => {
                        const question = `Delete the listener "${listener.name}"? The books it found stay.`;
                        if (!window.confirm(question)) event.preventDefault();
                      }}
                    >
                      <input type="hidden" name="id" value={listener.id} />
                      <button
                        type="submit"
                        name="intent"
                        value="delete"
                        className="text-red-600 hover:underline dark:text-red-400"
                      >
                        Delete
                      </button>
                    </Form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
