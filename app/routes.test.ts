import { describe, expect, it } from 'vitest';

import routes from './routes';

describe('routes', () => {
  it('serves the home page at the index route', () => {
    expect(routes).toContainEqual(
      expect.objectContaining({ index: true, file: 'routes/home.tsx' }),
    );
  });

  it('serves the listener pages', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'listeners', file: 'routes/listeners.tsx' }),
        expect.objectContaining({ path: 'listeners/new', file: 'routes/listenerForm.tsx' }),
        expect.objectContaining({ path: 'listeners/:id/edit', file: 'routes/listenerForm.tsx' }),
      ]),
    );
  });
});
