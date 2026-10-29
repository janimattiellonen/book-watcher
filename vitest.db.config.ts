import { defineConfig } from 'vitest/config';

// `npm run test:db`: tests against the real Postgres test database. A separate file
// suffix keeps them out of `npm test`, which must run without a database.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.dbtest.ts'],
    environment: 'node',
    // Test files share one database and truncate its tables, so they must not overlap.
    fileParallelism: false,
  },
});
