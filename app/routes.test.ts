import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import routes from './routes';

describe('routes', () => {
  it('serves the four book views from one module, suggestions at the index', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: true, file: 'routes/books.tsx' }),
        expect.objectContaining({ path: ':view', file: 'routes/books.tsx' }),
        expect.objectContaining({ path: 'books/status', file: 'routes/bookStatus.ts' }),
      ]),
    );
  });

  it('serves /series and a series page, not the book view route', () => {
    // React Router's own matcher, given the config's paths; the route id carries the file.
    const objects = routes.map((entry) => ({ path: entry.path ?? '', id: entry.file }));
    const fileFor = (path: string) => matchRoutes(objects, path)?.at(-1)?.route.id;
    expect(fileFor('/series')).toBe('routes/series.tsx');
    expect(fileFor('/series/3')).toBe('routes/seriesDetail.tsx');
    expect(fileFor('/read')).toBe('routes/books.tsx');
  });

  it('serves the listener pages', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'listeners', file: 'routes/listeners.tsx' }),
        expect.objectContaining({ path: 'listeners/new', file: 'routes/listenerForm.tsx' }),
        expect.objectContaining({ path: 'listeners/:id', file: 'routes/listenerDetail.tsx' }),
        expect.objectContaining({ path: 'runs', file: 'routes/runs.tsx' }),
        expect.objectContaining({ path: 'listeners/:id/edit', file: 'routes/listenerForm.tsx' }),
      ]),
    );
  });
});
