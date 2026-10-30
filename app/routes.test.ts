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
