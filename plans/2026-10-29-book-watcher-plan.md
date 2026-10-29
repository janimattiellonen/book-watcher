# Implementation Plan: Book Watcher

Spec: [`specs/2026-10-29-book-watcher.md`](../specs/2026-10-29-book-watcher.md)
Status: **Draft, awaiting review**

## Overview

Build a local tool with three parts:

- **Scrapers** that drive headless Chromium against Bokus and Adlibris.
- A **rate-limited scheduler** that runs each listener at most once a day,
  spread out over the day.
- A **React Router 8 + Tailwind website** on `:3192` for managing listeners and
  marking books.

Everything shares one Postgres 17 database (Docker, `:5499`) and one set of
repository modules in `src/`. The riskiest part, parsing the store pages, comes
early so problems surface before the rest is built on top of it.

## Architecture Decisions

- **Single npm package.** `app/` holds the website and `src/` everything else.
  The website imports from `src/`, never the other way round. Two processes
  (`npm run dev`/`start` and `npm run scheduler`) share the code and the database.
- **Parsers are pure functions.** Each source adapter is split in two:
  - `fetchPages()` (Playwright, side effects) returns raw page content;
  - `parse<Source>(html)` returns `SearchResult[]` and is tested against saved
    fixtures.

  This way most tests never touch the network.

- **Scheduling policy is a pure function.**
  `pickNextListener(listeners, lastRunEndedAt, now, config)` decides what may
  run. It is tested with a fake clock. The cron tick only calls it, and a
  Postgres advisory lock prevents overlapping runs, including manual ones.
- **The run service has injectable dependencies.** `runListener()` takes its
  sources, clock and DB as arguments, so the seed, watch, suspicious-result and
  notification rules are DB-tested with fake sources.
- **Reference implementations:**
  - migrations: talokatsastus-api (`node-pg-migrate`, SQL, `src/scripts/migrate.ts`);
  - mailer and scheduler style: player-tracker (`Mailer` interface, Nodemailer
    and Resend, `EMAIL_MOCK_MODE`, `node-cron`).

## Dependency Graph

```
T1 scaffold ──► T2 db+migrate ──► T3 schema ──► T7 repositories ──┬─► T8 listener UI
                                                                  ├─► T9 run service ─► T10 rate limiter + CLI ─► T12 scheduler
T4 browser+Bokus ─┐                                               │                   T11 notifications ──────────┘
T5 Adlibris ──────┼─► (T9 needs sources)                          └─► T13–T15 book & runs UI
T6 matching ──────┘
```

T4, T5 and T6 can be done in parallel after T1. T8 and T11 can be done in
parallel after T7.

## Task List

### Phase 1: Foundation

#### Task 1: Scaffold the project

**Description:** Create a React Router 8 framework-mode app (TypeScript, SSR) in
this directory, with Tailwind, ESLint (flat config with typescript-eslint and
eslint-config-prettier), Prettier, Vitest and `tsx`. The dev server and
`start` run on port 3192. Add `.gitignore` (including `.env`), `.env.example`,
and `git init`. First check that the newest React Router 8.x is released, and
stop to report back if it isn't.

**Acceptance criteria:**

- [ ] `npm run dev` serves a Tailwind-styled placeholder page at `http://localhost:3192`.
- [ ] `npm run lint`, `npm run typecheck`, `npm run format` and `npm test` (one trivial test) pass.
- [ ] `npm run check` runs all of the above.

**Verification:** `npm run check`, `npm run build`, and opening `localhost:3192` in a browser.

**Dependencies:** None

**Files likely touched:** `package.json`, `react-router.config.ts`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `app/root.tsx`, `app/routes.ts`, `app/app.css`

**Estimated scope:** M

#### Task 2: Set up the database, env config and migration runner

**Description:** Add `docker-compose.yml` (`postgres:17`, host port 5499, named
volume, healthcheck, an init script that creates `book_watcher_test`). Add
`src/config.ts`, which validates env with zod and fails fast on missing or
invalid values. Add `src/db/pool.ts` (`pg` Pool) and
`src/scripts/migrate.ts`, ported from talokatsastus-api. Add the npm scripts
`db:up`, `db:down`, `db:migrate`, `db:migrate:down`, `db:migrate:create` and
`test:db`.

**Acceptance criteria:**

- [ ] `npm run db:up` starts a healthy Postgres 17 on `localhost:5499` with the dev and test databases.
- [ ] `npm run db:migrate` runs and creates `pgmigrations`. A wrong argument exits non-zero with usage text.
- [ ] An invalid `.env` value (e.g. `LISTENER_INTERVAL_HOURS=12`) makes config loading throw with a clear message.

**Verification:** `docker compose ps` shows the container as healthy, `npm run db:migrate` succeeds, and the unit test for `config.ts` passes.

**Dependencies:** T1

**Files likely touched:** `docker-compose.yml`, `docker/init-test-db.sql`, `src/config.ts`, `src/db/pool.ts`, `src/scripts/migrate.ts`

**Estimated scope:** M

#### Task 3: Write the schema migrations

**Description:** Create SQL migrations for `listeners`, `books`, `book_offers`,
`listener_books`, `runs` and `notifications`, exactly as the spec describes.
Add a `set_updated_at` trigger function, plus indexes on `books(status)`,
`books(notify_pending) WHERE notify_pending` and
`runs(listener_id, started_at DESC)`. Write a `docs/migrations.md` based on
talokatsastus-api's.

**Acceptance criteria:**

- [ ] `db:migrate` creates every table, constraint and index.
- [ ] `db:migrate:down` once per migration fully reverses them, and `db:migrate` re-applies them cleanly.
- [ ] The check constraints reject invalid data (min > max price, unknown status).

**Verification:** A down-then-up round trip, and a `psql \d+` inspection.

**Dependencies:** T2

**Files likely touched:** `migrations/*.sql` (4–6 files), `docs/migrations.md`

**Estimated scope:** S

### Checkpoint 1: Foundation

- [ ] `npm run check` passes and the migrations round-trip.
- [ ] The website shell runs on :3192.
- [ ] **Review with you before the scrapers are built.**

### Phase 2: Sources (highest risk first)

**Fixture-first rule for the whole phase:** parsers are developed and tested
offline against saved HTML. Live requests are only used to capture fixtures:

- **At most 5 live page loads per store for all of T4/T5.** Each one is logged
  in `tests/fixtures/<source>/CAPTURES.md` (date, URL, purpose).
- Start from the HTML already captured in the PoC, which is saved in
  `tests/fixtures/{bokus,adlibris}/` (a results page and the checkpoint page
  for each store). Only make new requests for pages that aren't covered yet.
- The capture script, `npm run capture -- --source <s> --author ... --language ...`,
  is the only thing that hits a store during development. It saves the
  rendered HTML (plus a screenshot) to `tests/fixtures/<source>/<slug>.html` and
  refuses to overwrite an existing capture without `--overwrite`.
- `npm run search` parses a saved fixture by default (`--fixture <file>`).
  Fetching live requires an explicit `--live`.
- Pages to capture, each only once: a normal results page, an empty results
  page, a second page (if pagination exists), and a single-result page. The
  checkpoint page is already saved from the earlier `curl` probe.

#### Task 4: Shared browser helper, Bokus adapter and `search` debug script

**Description:** `src/sources/browser.ts` launches headless Chromium with a
normal desktop UA and locale, waits out the Vercel checkpoint (polling until
the title no longer matches), and applies the 5–10 s polite delay between page
loads. `src/sources/bokus.ts` contains:

- the URL builder (`q`, `facets=format:EBOOK,languageCodes:<code>`);
- pagination up to `MAX_PAGES_PER_SEARCH`;
- a pure `parseBokus(html)`, which reads the DOM (the embedded Next.js data
  covers only the server-rendered first page, so it can't serve a "load more"
  page), and extracts title, authors, ISBN-13 (from `/bok/<isbn>/`),
  format, language, price/currency, URL and cover.

Output is validated with zod. This task also adds `npm run capture` and
`npm run search` (fixture by default, `--live` opt-in), as described under the
fixture-first rule above.

**Acceptance criteria:**

- [ ] `parseBokus` on the saved "Viveca Sten" (sv, e-book) fixture returns 27 results with ISBN, price in SEK and URL for each.
- [ ] `parseBokus` fixture tests pass for a full results page, an empty results page and the checkpoint page (which must throw `BlockedError`, not return `[]`).
- [ ] Pagination is understood and documented, and covered by a fixture if the store paginates.
- [ ] No more than 5 live Bokus page loads in total, all logged in `CAPTURES.md`.

**Verification:** `npm test -- bokus`, plus a single live `npm run search -- --live` at the very end as a smoke test (it counts toward the 5).

**Dependencies:** T1

**Files likely touched:** `src/sources/browser.ts`, `src/sources/types.ts`, `src/sources/bokus.ts`, `src/sources/bokus.test.ts`, `src/scripts/search.ts`, `tests/fixtures/bokus/*`

**Estimated scope:** M

#### Task 5: Adlibris adapter

**Description:** `src/sources/adlibris.ts` builds the URL
(`/fi/haku?q=…&refinementList[language][0]=<fi label>&refinementList[format][0]=E-kirja`)
and parses the page with a pure `parseAdlibris(html)` (DOM only: the JSON-LD has no
products and the Next.js data lacks the cards; ISBN from `/fi/kirja/<slug>-<isbn>`; EUR prices in
`16,60 €` format). It includes the language map (`fi→suomi`, `sv→ruotsi`,
`en→englanti`) and is wired into `npm run search`.

**Acceptance criteria:**

- [ ] `parseAdlibris` on the saved "Heikki Hietala" (fi, e-book) fixture returns 4 results with ISBN, a correctly parsed EUR price and URL.
- [ ] Fixture tests pass for results, empty and checkpoint pages.
- [ ] No more than 5 live Adlibris page loads in total, all logged in `CAPTURES.md`.

**Verification:** `npm test -- adlibris`, plus a single live `npm run search -- --live` smoke test at the end (it counts toward the 5).

**Dependencies:** T1 (reuses `browser.ts` from T4; if T4 isn't done yet, coordinate on `types.ts` first)

**Files likely touched:** `src/sources/adlibris.ts`, `src/sources/adlibris.test.ts`, `src/sources/index.ts`, `tests/fixtures/adlibris/*`

**Estimated scope:** S–M

#### Task 6: Matching and normalization rules

**Description:** These are pure functions in `src/watcher/matching.ts`:

- `normalizeName` (case, diacritics, whitespace, "Sten, Viveca" → "viveca sten");
- `matchesAuthor`, `normalizeIsbn`, `dedupeKey` (ISBN or `ta:` fallback);
- `toEur` (SEK via `SEK_TO_EUR`), `inPriceRange` (open-ended bounds);
- `matchesListener` (author, format, language and price combined).

**Acceptance criteria:**

- [ ] Authors match regardless of diacritics and name order, and do not match co-mentions such as "Viveca Stenberg" or a book _about_ the author.
- [ ] Both bounds of the price range are inclusive, and either bound can be null.
- [ ] The same ISBN in different formatting gives the same dedupe key.

**Verification:** `npm test -- matching`

**Dependencies:** T1

**Files likely touched:** `src/watcher/matching.ts`, `src/watcher/matching.test.ts`

**Estimated scope:** S

### Checkpoint 2: Sources

- [ ] Both live smoke-test searches return correct, parsed results.
- [ ] `CAPTURES.md` shows the live-request budget was respected.
- [ ] All parser and matching tests pass.
- [ ] **Review with you, including how pagination behaves.**

### Phase 3: Data layer and listener management

#### Task 7: Repositories

**Description:** Write the `src/db/` repositories with typed, parameterized SQL:

- `listeners` (CRUD, `listDue`, `setLastRunAt`, `activate`);
- `books` (`upsertFromResult` returning `{ book, created, becameEligible }`,
  `setStatus` for one or many books, the list queries per status and listener);
- `offers` (upsert per `(book, source)`);
- `listenerBooks`, `runs` (start/finish, `lastFinishedAt`, recent list,
  `hadResultsBefore`), `notifications`.

Add a test helper that truncates tables in `book_watcher_test`.

**Acceptance criteria:**

- [ ] Upserting the same ISBN from two sources gives one book with two offers.
- [ ] `setStatus` updates `status_changed_at`, and the bulk version runs in one statement.
- [ ] Every repository function has a `*.dbtest.ts` covering its main path.

**Verification:** `npm run test:db`

**Dependencies:** T3, T6 (dedupe keys)

**Files likely touched:** `src/db/listeners.ts`, `src/db/books.ts`, `src/db/runs.ts`, `src/db/notifications.ts`, `src/db/*.dbtest.ts`, `src/db/testUtils.ts`

**Estimated scope:** M–L (split into books/offers and listeners/runs if it grows)

#### Task 8: Listener management UI

**Description:** Add an app layout with Tailwind navigation (Suggestions,
Reading list, Read, Rejected, Listeners, Runs). Add the `/listeners` list, with
name, author, language, sources, enabled, seed state and last run, and the
`/listeners/new` and `/listeners/:id/edit` forms. Forms are validated with zod
in actions and show field errors. There are also delete (with confirmation)
and enable/disable actions.

**Acceptance criteria:**

- [ ] I can create, edit, disable and delete a listener. Invalid input (empty author, min > max, no source) shows errors and saves nothing.
- [ ] A new listener shows seed state `pending`.
- [ ] Deleting a listener leaves its books in place.

**Verification:** Action tests for validation, and a manual check in the browser.

**Dependencies:** T7

**Files likely touched:** `app/root.tsx`, `app/routes.ts`, `app/routes/listeners.tsx`, `app/routes/listenerForm.tsx`, `app/lib/listenerSchema.ts`

**Estimated scope:** M

### Phase 4: Watch pipeline

#### Task 9: Listener run service

**Description:** `src/watcher/runListener.ts` runs one listener as follows:

1. Pick the run kind: `seed` if the listener is pending, otherwise `watch`.
2. For each source, in order:
   - search it, with a `runs` row per source;
   - apply `matchesListener`;
   - upsert the books, offers and `listener_books`;
   - on a `watch` run, set `notify_pending` for books that are newly created
     or that just became eligible;
   - apply the suspicious-result guard (0 results where there were results
     before → `suspicious`, nothing written).
3. Activate the listener only if every source succeeded on a seed.
4. Always set `last_run_at`.

Sources and the clock are injected.

**Acceptance criteria:**

- [ ] A seed records books with `found_during_seed=true` and `notify_pending=false`, and activates the listener only if all sources succeeded.
- [ ] A seed with one failing source leaves the listener `pending`, records the error, and sets `last_run_at`.
- [ ] A watch run flags new books and in-range price drops for notification, but not already known books. Book statuses are never changed.

**Verification:** `npm run test:db -- runListener` (fake sources)

**Dependencies:** T4, T5, T6, T7

**Files likely touched:** `src/watcher/runListener.ts`, `src/watcher/runListener.dbtest.ts`, `src/sources/index.ts`

**Estimated scope:** M

#### Task 10: Rate-limit policy, run lock and `run-listener` CLI

**Description:** `src/watcher/schedulePolicy.ts` contains the pure
`pickNextListener({ listeners, lastRunEndedAt, now, config, random })`. It
enforces the per-listener interval (≥ 24 h), the global gap with jitter, and the
pick order (pending first, then the oldest `last_run_at`). It also provides
`nextExpectedRun` for the UI. `src/watcher/lock.ts` wraps
`pg_try_advisory_lock`. `npm run run-listener -- --listener <id> [--force]`
follows the same rules and prints why it refuses when it can't run.

**Acceptance criteria:**

- [ ] With a fake clock, a listener never runs twice within 24 h, and no two runs start less than `MIN_GAP_MINUTES` apart.
- [ ] A pending seed is picked before an active listener that is due.
- [ ] A manual run while the scheduler holds the lock refuses, even with `--force`.

**Verification:** `npm test -- schedulePolicy`, a lock DB test, and a manual CLI run that seeds a real listener once and then refuses a second immediate run.

**Dependencies:** T9

**Files likely touched:** `src/watcher/schedulePolicy.ts`, `src/watcher/schedulePolicy.test.ts`, `src/watcher/lock.ts`, `src/scripts/runListener.ts`

**Estimated scope:** M

#### Task 11: Daily e-mail digest

**Description:** Port player-tracker's `Mailer` interface, the Nodemailer and
Resend implementations and the mock mode.

- `src/notifications/digest.ts` builds the digest e-mail: a subject, then
  text and HTML grouped by author, with title, price per source, links, and a
  link to `localhost:3192`.
- `src/notifications/digestPolicy.ts` contains the pure
  `isDigestDue({ now, digestTime, completedToday, lastFailedAt })`. The digest is
  due when local time ≥ `DIGEST_TIME`, no digest has been completed today, and
  the last failure (if any) was at least 30 minutes ago.
- `sendDailyDigest(db, mailer, now)` reads the `notify_pending` books and
  either records `empty` or sends one e-mail. On success it records
  `sent`/`mocked`, clears the flags and sets `notified_at` in one transaction.
  On failure it records `failed` and leaves the flags. `setStatus` clears the flag
  of a book moved away from `new`, so the digest never sends triaged books.

`EMAIL_NOTIFICATIONS_ENABLED` (default `false`) and `DIGEST_TIME` (default
`05:00`) go into `config.ts`. Includes `npm run digest -- [--force]` and
`npm run test-email`.

**Acceptance criteria:**

- [ ] With a fake clock: not due at 04:59. Due at 05:00, and at 09:30 if 05:00 was missed. Not due again the same day after `sent`, `mocked` or `empty`. Due again 30 minutes after a `failed` attempt.
- [ ] No queued books means no e-mail, and an `empty` row is recorded. A failing mailer leaves the books queued.
- [ ] With `EMAIL_NOTIFICATIONS_ENABLED=false`, nothing is sent or recorded, and the books stay queued.

**Verification:** Unit tests for `digestPolicy` and the digest content, DB tests for `sendDailyDigest`, and `npm run digest -- --force` in mock mode.

**Dependencies:** T7

**Files likely touched:** `src/notifications/mailer.ts`, `src/notifications/nodemailerMailer.ts`, `src/notifications/resendMailer.ts`, `src/notifications/digest.ts`, `src/notifications/digestPolicy.ts`, `src/notifications/sendDailyDigest.ts`, `src/scripts/digest.ts`, `src/scripts/testEmail.ts` (split the mailer port into its own task if it grows)

**Estimated scope:** M

#### Task 12: Scheduler process

**Description:** `src/scripts/scheduler.ts` runs a `node-cron` tick every
minute. On each tick it:

1. sends the daily digest if notifications are enabled and `isDigestDue`
   says so (guarded so two digests can't overlap);
2. takes the scraping lock, and skips the rest if it can't;
3. calls `pickNextListener`;
4. runs that listener;
5. releases the lock.

On startup it logs its config (interval, gap, jitter, how many listeners are
due, whether notifications are on, and the digest time). It shuts down cleanly
on SIGINT/SIGTERM, letting the current run finish or closing the browser.

**Acceptance criteria:**

- [ ] A scheduler started with 2 due listeners runs one immediately and the second only after the gap.
- [ ] A listener run never triggers an e-mail. The digest is sent only by the digest step, even while a listener run is in progress.
- [ ] An exception in a run is logged and doesn't kill the process.
- [ ] Ctrl+C during a run leaves no orphaned Chromium processes.

**Verification:** A manual run with `MIN_GAP_MINUTES=1` (development only), watching the logs and the `runs` table.

**Dependencies:** T10, T11

**Files likely touched:** `src/scripts/scheduler.ts`, `src/watcher/tick.ts`, `src/watcher/tick.test.ts`

**Estimated scope:** S–M

### Checkpoint 3: Pipeline end to end

- [ ] Create a listener for Viveca Sten (sv, Bokus + Adlibris) in the UI, seed it with `run-listener`, and see books in the DB with no e-mail sent.
- [ ] Delete one book row and re-run with `--force`. The book is queued but no e-mail is sent. `npm run digest -- --force` (mock mode, notifications enabled) then sends exactly one digest containing it, and a second `npm run digest` without `--force` does nothing.
- [ ] `npm run check` and `npm run test:db` pass.
- [ ] **Review with you.**

### Phase 5: Book review UI

#### Task 13: Suggestion and status views with marking

**Description:** Add `/` (Suggestions: `new`), `/reading-list` (`accepted`),
`/read` and `/rejected`. Each is a book card list with cover, title, authors,
prices and links per source, and the listener. Each card has status buttons
that submit to an action (the page keeps working without JS). All views can be
filtered by listener. They are sorted newest first, by `first_seen_at` or
`status_changed_at`.

**Acceptance criteria:**

- [ ] Marking a book moves it to the right view, and any status can be changed to any other.
- [ ] A book on both stores shows as one card with two prices.
- [ ] The listener filter works on every view.

**Verification:** Loader/action tests for status changes, and a manual browser check.

**Dependencies:** T7, T8 (layout)

**Files likely touched:** `app/routes/books.tsx` (one route module parameterized by status), `app/components/BookCard.tsx`, `app/components/StatusButtons.tsx`, `app/routes/bookStatus.ts`

**Estimated scope:** M

#### Task 14: Listener detail page with seed bulk marking

**Description:** `/listeners/:id` shows the listener's settings, seed state,
last and next expected run, and the books it found. Seeded books can be
checkbox-selected (with a "select all" option) and bulk-marked as read,
accepted or rejected.

**Acceptance criteria:**

- [ ] Bulk-marking 30 seeded books takes one form submit and updates them all.
- [ ] The page shows the next expected run, computed by `nextExpectedRun`.

**Verification:** An action test for bulk status, and a manual check against the seeded listener from Checkpoint 3.

**Dependencies:** T10, T13

**Files likely touched:** `app/routes/listenerDetail.tsx`, `app/components/BulkStatusForm.tsx`

**Estimated scope:** S–M

#### Task 15: Runs view and capacity warning

**Description:** `/runs` lists the latest runs (listener, source, kind, status,
results, new books, error, duration), with failed and suspicious runs
highlighted. The listeners page shows a warning when the enabled listeners
can't all fit into 24 hours with the configured gap.

**Acceptance criteria:**

- [ ] Failed and suspicious runs stand out visually and show their error text.
- [ ] The capacity warning appears when the listener count × (gap + average run duration) exceeds 24 h.

**Verification:** A unit test for the capacity calculation, and a manual check.

**Dependencies:** T10, T8

**Files likely touched:** `app/routes/runs.tsx`, `app/routes/listeners.tsx`, `src/watcher/capacity.ts`

**Estimated scope:** S

### Phase 6: Polish

#### Task 16: README and final verification

**Description:** Write a README covering setup (Docker, `playwright install
chromium`, `.env`), daily usage (start the website and the scheduler), adding an
author (create a listener, wait for or run the seed, bulk-mark), the rate-limit
settings and troubleshooting (suspicious runs, refreshing parser fixtures).
Then do a final pass through the spec's success criteria.

**Acceptance criteria:**

- [ ] A fresh clone gets to a working setup by following only the README.
- [ ] Every success criterion in the spec is checked off, with evidence.

**Verification:** Walk through the README from scratch, plus `npm run check` and `npm run test:db`.

**Dependencies:** All

**Files likely touched:** `README.md`, `.env.example`, `CLAUDE.md`

**Estimated scope:** S

### Checkpoint: Complete

- [ ] All the spec's success criteria are met.
- [ ] The scheduler has run for at least a day with real listeners, and no listener ran more than once.
- [ ] One real digest e-mail arrived at about 05:00, or nothing arrived because nothing was queued.
- [ ] **Final review with you.**

## Risks and Mitigations

| Risk                                                                          | Impact | Mitigation                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A store tightens the Vercel checkpoint, or blocks headless Chromium           | High   | Detect the checkpoint page and throw `BlockedError`, so a block never looks like "0 results". Failed runs still count toward the daily limit, so a blocking store isn't hammered. Fallback: run headed Chromium or a persistent browser profile (ask first). |
| Store markup changes and breaks a parser                                      | High   | Prefer embedded JSON over CSS selectors. Zod validation fails loudly. The suspicious-result guard catches silent breakage. Refresh fixtures with `--save-fixture`.                                                                                           |
| Search returns books by other authors (anthologies, books _about_ the author) | Med    | Strict author matching on parsed author lists (T6), covered by tests.                                                                                                                                                                                        |
| The same book has different ISBNs per store or per edition                    | Med    | Accept occasional duplicates. The ISBN-less fallback key covers the rest. Revisit if it happens often.                                                                                                                                                       |
| Large back catalogues need many pages                                         | Med    | `MAX_PAGES_PER_SEARCH` with 5–10 s delays. A seed that hits the cap is logged as a warning, not silently truncated.                                                                                                                                          |
| React Router 8 not yet released or still unstable                             | Low    | Check in T1, and ask before falling back to v7.                                                                                                                                                                                                              |
| The fixed SEK→EUR rate drifts                                                 | Low    | It's configurable in `.env`, and price ranges are rough anyway.                                                                                                                                                                                              |
| The Mac is asleep or the scheduler isn't running at 05:00                     | Low    | Catch-up rule: the digest is sent at the first wake-up after `DIGEST_TIME`, still at most once a day.                                                                                                                                                        |

## Parallelization

- After T1, these can run in parallel: **T4 + T5 + T6** (agree on `src/sources/types.ts` first).
- After T7: **T8 ∥ T11**.
- After T10: **T13 ∥ T15**.
- Migrations (T3) and the run service (T9) are strictly sequential.

## Open Questions

- None blocking. One design choice to be aware of: **failed runs count toward the
  daily limit**, so a new listener whose seed fails waits about 24 h before the
  automatic retry. `run-listener --force` is the manual escape hatch.
