import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPool } from './pool.js';

describe('createPool', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs idle client errors instead of throwing them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool({
      host: 'localhost',
      port: 1,
      user: 'u',
      password: 'p',
      database: 'd',
    });
    const error = new Error('connection terminated');

    expect(() => pool.emit('error', error, undefined as never)).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
    await pool.end();
  });
});
