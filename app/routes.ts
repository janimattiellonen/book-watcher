import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  // One module serves the four book views: the index is Suggestions, and `:view` picks
  // the others (app/lib/bookViews.ts). An unknown view is a 404.
  index('routes/books.tsx', { id: 'books-suggestions' }),
  route(':view', 'routes/books.tsx', { id: 'books-view' }),
  route('books/status', 'routes/bookStatus.ts'),
  route('listeners', 'routes/listeners.tsx'),
  // One form module serves both; distinct ids keep the two routes apart.
  route('listeners/new', 'routes/listenerForm.tsx', { id: 'listener-new' }),
  route('listeners/:id/edit', 'routes/listenerForm.tsx', { id: 'listener-edit' }),
] satisfies RouteConfig;
