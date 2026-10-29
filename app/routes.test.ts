import { describe, expect, it } from 'vitest';

import routes from './routes';

describe('routes', () => {
  it('serves the home page at the index route', () => {
    expect(routes).toContainEqual(
      expect.objectContaining({ index: true, file: 'routes/home.tsx' }),
    );
  });
});
