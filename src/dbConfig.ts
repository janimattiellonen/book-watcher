import { z } from 'zod';

import { parseEnv } from './parseEnv.js';

// Parsed separately from src/config.ts so that `npm run db:migrate` depends only on
// the database variables, not on scheduler or e-mail settings it never uses.
const schema = z.object({
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5499),
  POSTGRES_USER: z.string().min(1).default('book_watcher'),
  POSTGRES_PASSWORD: z.string().min(1).default('book_watcher'),
  POSTGRES_DB: z.string().min(1).default('book_watcher'),
});

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const parsed = parseEnv('database', schema, env);
  return {
    host: parsed.POSTGRES_HOST,
    port: parsed.POSTGRES_PORT,
    user: parsed.POSTGRES_USER,
    password: parsed.POSTGRES_PASSWORD,
    database: parsed.POSTGRES_DB,
  };
}
