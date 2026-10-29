import { loadDbConfig } from '../dbConfig.js';
import { createPool, type Db } from './pool.js';

// DB tests truncate tables, so they must never run against the development database
// (the default `POSTGRES_DB`). Only `npm run test:db` selects the `_test` database;
// this check makes a direct `vitest --config vitest.db.config.ts` fail instead of
// wiping dev data. Every `*.dbtest.ts` file must create its pool through here.
export function assertTestDatabase(database: string): void {
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run DB tests against "${database}": the database name must end in "_test". ` +
        'Use `npm run test:db`, or set POSTGRES_DB=book_watcher_test.',
    );
  }
}

export function createTestPool(): Db {
  const config = loadDbConfig();
  assertTestDatabase(config.database);
  return createPool(config);
}
