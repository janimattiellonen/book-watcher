import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: the React Router plugin is for the app build and
// must not run under the test runner.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['{app,src}/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
