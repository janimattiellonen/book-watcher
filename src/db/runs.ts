import type { SourceId } from '../sources/types.js';
import type { Queryable } from './pool.js';

export type RunKind = 'seed' | 'watch';
export type RunStatus = 'running' | 'ok' | 'failed' | 'suspicious';

export interface Run {
  id: number;
  /** Null once the listener has been deleted. */
  listenerId: number | null;
  /** The listener's current name, or null once it has been deleted. */
  listenerName: string | null;
  source: SourceId;
  kind: RunKind;
  status: RunStatus;
  /** How many results the search returned, before matching. */
  results: number | null;
  newBooks: number | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

interface RunRow {
  id: number;
  listener_id: number | null;
  listener_name: string | null;
  source: SourceId;
  kind: RunKind;
  status: RunStatus;
  results: number | null;
  new_books: number | null;
  error: string | null;
  started_at: Date;
  finished_at: Date | null;
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    listenerId: row.listener_id,
    listenerName: row.listener_name,
    source: row.source,
    kind: row.kind,
    status: row.status,
    results: row.results,
    newBooks: row.new_books,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** Records the start of one listener-source search. Returns the run id. */
export async function startRun(
  db: Queryable,
  run: { listenerId: number; source: SourceId; kind: RunKind; now: Date },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO runs (listener_id, source, kind, status, started_at)
     VALUES ($1, $2, $3, 'running', $4)
     RETURNING id`,
    [run.listenerId, run.source, run.kind, run.now],
  );
  return rows[0].id;
}

export interface RunOutcome {
  status: Exclude<RunStatus, 'running'>;
  results: number | null;
  newBooks: number | null;
  error: string | null;
  now: Date;
}

export async function finishRun(db: Queryable, id: number, outcome: RunOutcome): Promise<void> {
  await db.query(
    `UPDATE runs SET status = $2, results = $3, new_books = $4, error = $5, finished_at = $6
     WHERE id = $1`,
    [id, outcome.status, outcome.results, outcome.newBooks, outcome.error, outcome.now],
  );
}

/**
 * When the most recent run of any listener ended, or null if none has. The gap between
 * listener runs is measured from here, so it still holds after a listener is deleted.
 */
export async function lastFinishedAt(db: Queryable): Promise<Date | null> {
  const { rows } = await db.query<{ at: Date | null }>('SELECT max(finished_at) AS at FROM runs');
  return rows[0].at;
}

/**
 * Whether a search of this source for this listener has ever returned results. The
 * suspicious-result guard treats 0 results after that as a sign of breakage.
 */
export async function hadResultsBefore(
  db: Queryable,
  listenerId: number,
  source: SourceId,
): Promise<boolean> {
  const { rows } = await db.query<{ had: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM runs WHERE listener_id = $1 AND source = $2 AND results > 0
     ) AS had`,
    [listenerId, source],
  );
  return rows[0].had;
}

/** The latest runs, newest first, optionally for one listener. */
export async function listRecentRuns(
  db: Queryable,
  { limit, listenerId }: { limit: number; listenerId?: number },
): Promise<Run[]> {
  const { rows } = await db.query<RunRow>(
    `SELECT r.*, l.name AS listener_name
     FROM runs r LEFT JOIN listeners l ON l.id = r.listener_id
     WHERE $2::bigint IS NULL OR r.listener_id = $2
     ORDER BY r.started_at DESC, r.id DESC
     LIMIT $1`,
    [limit, listenerId ?? null],
  );
  return rows.map(toRun);
}
