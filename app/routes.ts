import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('listeners', 'routes/listeners.tsx'),
  // One form module serves both; distinct ids keep the two routes apart.
  route('listeners/new', 'routes/listenerForm.tsx', { id: 'listener-new' }),
  route('listeners/:id/edit', 'routes/listenerForm.tsx', { id: 'listener-edit' }),
] satisfies RouteConfig;
