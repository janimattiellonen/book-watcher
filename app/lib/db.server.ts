import './env.server';

import { createPool, type Db } from '../../src/db/pool';

// One pool for the whole server. In development, Vite re-imports this module on every
// change; keeping the pool on globalThis stops each reload from opening new connections.
const globalForDb = globalThis as typeof globalThis & { bookWatcherDb?: Db };

export const db: Db = (globalForDb.bookWatcherDb ??= createPool());
