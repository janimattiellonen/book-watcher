import type { Format, SourceId } from '../sources/types.js';
import type { Queryable } from './pool.js';

export type SeedState = 'pending' | 'active';

export interface Listener {
  id: number;
  name: string;
  author: string;
  language: string;
  format: Format;
  minPriceEur: number | null;
  maxPriceEur: number | null;
  sources: SourceId[];
  enabled: boolean;
  seedState: SeedState;
  seededAt: Date | null;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The fields set from the listener form. */
export interface ListenerInput {
  name: string;
  author: string;
  language: string;
  format: Format;
  minPriceEur: number | null;
  maxPriceEur: number | null;
  sources: SourceId[];
  enabled: boolean;
}

interface ListenerRow {
  id: number;
  name: string;
  author: string;
  language: string;
  format: Format;
  min_price_eur: number | null;
  max_price_eur: number | null;
  sources: SourceId[];
  enabled: boolean;
  seed_state: SeedState;
  seeded_at: Date | null;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toListener(row: ListenerRow): Listener {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    language: row.language,
    format: row.format,
    minPriceEur: row.min_price_eur,
    maxPriceEur: row.max_price_eur,
    sources: row.sources,
    enabled: row.enabled,
    seedState: row.seed_state,
    seededAt: row.seeded_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inputParams(input: ListenerInput): unknown[] {
  return [
    input.name,
    input.author,
    input.language,
    input.format,
    input.minPriceEur,
    input.maxPriceEur,
    input.sources,
    input.enabled,
  ];
}

export async function createListener(db: Queryable, input: ListenerInput): Promise<Listener> {
  const { rows } = await db.query<ListenerRow>(
    `INSERT INTO listeners
       (name, author, language, format, min_price_eur, max_price_eur, sources, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    inputParams(input),
  );
  return toListener(rows[0]);
}

export async function getListener(db: Queryable, id: number): Promise<Listener | null> {
  const { rows } = await db.query<ListenerRow>('SELECT * FROM listeners WHERE id = $1', [id]);
  return rows.length > 0 ? toListener(rows[0]) : null;
}

export async function listListeners(db: Queryable): Promise<Listener[]> {
  const { rows } = await db.query<ListenerRow>('SELECT * FROM listeners ORDER BY lower(name), id');
  return rows.map(toListener);
}

/** Returns the updated listener, or null if there is none with that id. */
export async function updateListener(
  db: Queryable,
  id: number,
  input: ListenerInput,
): Promise<Listener | null> {
  const { rows } = await db.query<ListenerRow>(
    `UPDATE listeners
     SET name = $2, author = $3, language = $4, format = $5,
         min_price_eur = $6, max_price_eur = $7, sources = $8, enabled = $9
     WHERE id = $1
     RETURNING *`,
    [id, ...inputParams(input)],
  );
  return rows.length > 0 ? toListener(rows[0]) : null;
}

export async function setListenerEnabled(
  db: Queryable,
  id: number,
  enabled: boolean,
): Promise<boolean> {
  const { rowCount } = await db.query('UPDATE listeners SET enabled = $2 WHERE id = $1', [
    id,
    enabled,
  ]);
  return rowCount === 1;
}

/** Removes the listener and its book links. The books, and its run history, stay. */
export async function deleteListener(db: Queryable, id: number): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM listeners WHERE id = $1', [id]);
  return rowCount === 1;
}

/**
 * Enabled listeners whose last run ended at least `intervalHours` before `now`, or that
 * never ran: pending seeds first, then the longest-waiting. The gap between runs of
 * different listeners is the schedule policy's business, not this query's.
 */
export async function listDue(
  db: Queryable,
  now: Date,
  intervalHours: number,
): Promise<Listener[]> {
  const { rows } = await db.query<ListenerRow>(
    `SELECT * FROM listeners
     WHERE enabled
       AND (last_run_at IS NULL OR last_run_at <= $1::timestamptz - make_interval(hours => $2))
     ORDER BY seed_state = 'pending' DESC, last_run_at ASC NULLS FIRST, id`,
    [now, intervalHours],
  );
  return rows.map(toListener);
}

/** Set at the end of every run, whatever its outcome (spec US-6). */
export async function setLastRunAt(db: Queryable, id: number, at: Date): Promise<void> {
  await db.query('UPDATE listeners SET last_run_at = $2 WHERE id = $1', [id, at]);
}

/** Marks a listener seeded. Only call it after the seed succeeded on every source. */
export async function activateListener(db: Queryable, id: number, at: Date): Promise<void> {
  await db.query(
    "UPDATE listeners SET seed_state = 'active', seeded_at = $2 WHERE id = $1 AND seed_state = 'pending'",
    [id, at],
  );
}
