import { describe, expect, it } from 'vitest';

import { assertTestDatabase } from './testPool.js';

describe('assertTestDatabase', () => {
  it('refuses the development database', () => {
    expect(() => assertTestDatabase('book_watcher')).toThrow(/must end in "_test"/);
  });

  it('accepts a _test database', () => {
    expect(() => assertTestDatabase('book_watcher_test')).not.toThrow();
  });
});
