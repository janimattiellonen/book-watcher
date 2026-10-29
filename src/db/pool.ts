import pg from 'pg';

import { type DbConfig, loadDbConfig } from '../dbConfig.js';

// `numeric` columns (prices) arrive as strings by default to avoid precision loss.
// Prices here have two decimals and stay far below 2^53, so numbers are safe.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type Db = pg.Pool;

export function createPool(config: DbConfig = loadDbConfig()): Db {
  return new pg.Pool(config);
}
