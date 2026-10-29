import pg from 'pg';

import { type DbConfig, loadDbConfig } from '../dbConfig.js';

// `numeric` (prices) and `bigint` (bigserial ids, count(*)) arrive as strings by
// default to avoid precision loss. Prices have two decimals and ids and counts stay
// far below 2^53, so plain numbers are safe here.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Db = pg.Pool;

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
