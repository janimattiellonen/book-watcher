import { runner } from 'node-pg-migrate';

import { loadDbConfig } from '../dbConfig.js';

const args = process.argv.slice(2);
const direction = args[0];

// Extra arguments are rejected rather than ignored: `npm run db:migrate sideways`
// appends to the script, so argv would otherwise read ['up', 'sideways'] and the
// typo would silently apply migrations.
if (args.length !== 1 || (direction !== 'up' && direction !== 'down')) {
  console.error(
    `Usage: migrate.ts <up|down> — received ${args.length > 0 ? args.join(' ') : 'no argument'}`,
  );
  process.exit(1);
}

try {
  await runner({
    databaseUrl: loadDbConfig(),
    dir: 'migrations',
    direction,
    count: direction === 'down' ? 1 : Infinity,
    migrationsTable: 'pgmigrations',
    verbose: true,
  });
} catch (error) {
  console.error(`Migration failed (${direction}):`, error);
  process.exit(1);
}
