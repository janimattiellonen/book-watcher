import pg from 'pg';

import { type DbConfig, loadDbConfig } from '../dbConfig.js';

// `numeric` (prices) and `bigint` (bigserial ids, count(*)) arrive as strings by
// default to avoid precision loss. Prices have two decimals and ids and counts stay
// far below 2^53, so plain numbers are safe here.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Db = pg.Pool;

export function createPool(config: DbConfig = loadDbConfig()): Db {
  return new pg.Pool(config);
}
