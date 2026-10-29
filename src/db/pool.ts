import pg from 'pg';

import { type DbConfig, loadDbConfig } from '../dbConfig.js';

// `numeric` (prices) and `bigint` (bigserial ids, count(*)) arrive as strings by
// default to avoid precision loss. Prices have two decimals and ids and counts stay
// far below 2^53, so plain numbers are safe here.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
// bigint[] (notifications.book_ids) has its own parser, which still yields strings. Its
// text form is '{1,2,3}': plain digits, no quoting, and our id arrays hold no NULLs.
// pg's TypeId enum lists only the scalar types, so the array OID needs a cast.
const BIGINT_ARRAY_OID = 1016 as (typeof pg.types.builtins)['INT8'];
pg.types.setTypeParser(BIGINT_ARRAY_OID, (value: string) =>
  value === '{}' ? [] : value.slice(1, -1).split(',').map(Number),
);
// A `date` has no time zone; parsing it into a Date would pin it to local midnight and
// shift the day for any other zone. It stays a 'YYYY-MM-DD' string.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Db = pg.Pool;

/** The pool or a client checked out of it, so repositories also run inside a transaction. */
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(config: DbConfig = loadDbConfig()): Db {
  const pool = new pg.Pool(config);
  // An error on an idle pooled client (Postgres restart, dropped connection) is emitted
  // on the pool; without a listener it is an uncaught exception that kills the process.
  // The broken client is discarded and the next query gets a fresh connection.
  pool.on('error', (error) => {
    console.error('Postgres pool: idle client error', error);
  });
  return pool;
}
