import { data, Link } from 'react-router';

import { type ListenerBook, listListenerBooks } from '../../src/db/books';
import { getListener, listListeners } from '../../src/db/listeners';
import { lastFinishedAt } from '../../src/db/runs';
import { nextExpectedRuns } from '../../src/watcher/schedulePolicy';
import { BookCard, formatDate } from '../components/BookCard';
import { BulkStatusForm } from '../components/BulkStatusForm';
import { StatusButtons } from '../components/StatusButtons';
import { bookStatusLabel } from '../lib/bookViews';
import { config } from '../lib/config.server';
import { db } from '../lib/db.server';
import { languageLabel, priceRange } from '../lib/listenerDisplay';
import { SOURCE_LABELS } from '../lib/listenerSchema';
import type { Route } from './+types/listenerDetail';

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.listener.name ?? 'Listener'} · Book Watcher` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const listener = /^\d+$/.test(params.id) ? await getListener(db, Number(params.id)) : null;
  if (!listener) throw data('Listener not found', { status: 404 });

  const [books, listeners, lastRunEndedAt] = await Promise.all([
    listListenerBooks(db, listener.id),
    listListeners(db),
    lastFinishedAt(db),
  ]);
  const nextRun = nextExpectedRuns({ listeners, lastRunEndedAt, now: new Date(), config }).get(
    listener.id,
  );
  return { listener, books, nextRun: nextRun ?? null };
}

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const describeBook = (book: ListenerBook) =>
  `${bookStatusLabel(book)} · Found ${formatDate(book.firstSeenAt)}`;

export default function ListenerDetail({ loaderData }: Route.ComponentProps) {
  const { listener, books, nextRun } = loaderData;
  const seeded = books.filter((book) => book.foundDuringSeed);
  const later = books.filter((book) => !book.foundDuringSeed);

  const settings: [string, string][] = [
    ['Author', listener.author],
    ['Language', languageLabel(listener.language)],
    ['Price', priceRange(listener.minPriceEur, listener.maxPriceEur)],
    ['Sources', listener.sources.map((source) => SOURCE_LABELS[source]).join(', ')],
    [
      'Seed',
      listener.seedState === 'active'
        ? `Done${listener.seededAt ? ` ${dateTime.format(listener.seededAt)}` : ''}`
        : 'Pending: the first run records what the author has already published',
    ],
    ['Last run', listener.lastRunAt ? dateTime.format(listener.lastRunAt) : 'Never'],
    [
      'Next run',
      !listener.enabled
        ? 'None while disabled'
        : nextRun
          ? `Expected around ${dateTime.format(nextRun)}`
          : 'Unknown',
    ],
  ];

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {listener.name}
          {listener.enabled ? null : (
            <span className="ml-2 text-base font-normal text-gray-500">(disabled)</span>
          )}
        </h1>
        <Link
          to={`/listeners/${listener.id}/edit`}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Edit
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        {settings.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-gray-500 dark:text-gray-400">{term}</dt>
            <dd className="text-gray-900 dark:text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Found during the seed
          <span className="ml-2 text-sm font-normal text-gray-500">{seeded.length}</span>
        </h2>
        {seeded.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {listener.seedState === 'pending' ? 'The seed hasn’t run yet.' : 'None.'}
          </p>
        ) : (
          <div className="mt-2">
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
              Books already out when the listener was created. Tick the ones you have read or don’t
              want, and mark them in one go.
            </p>
            <BulkStatusForm books={seeded} statusLabel={describeBook} />
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Found since
          <span className="ml-2 text-sm font-normal text-gray-500">{later.length}</span>
        </h2>
        {later.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">None yet.</p>
        ) : (
          <div className="mt-2">
            {later.map((book) => (
              <BookCard key={book.id} book={book} dateLabel={describeBook(book)}>
                <StatusButtons bookId={book.id} status={book.status} />
              </BookCard>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
