import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Book Watcher' }];
}

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Book Watcher</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">No suggestions yet.</p>
    </main>
  );
}
