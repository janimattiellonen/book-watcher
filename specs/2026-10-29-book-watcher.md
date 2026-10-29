# Spec: Book Watcher

Status: **Accepted** (2026-10-29; defaults accepted, Tailwind chosen, rate limiting added)
Date: 2026-10-29

## Objective

A local, single-user tool that watches selected online bookstores for **e-books by
chosen authors** and tells me when a new one appears that matches my language,
format and price requirements.

- **User:** me, running everything on my own machine. No authentication, no
  multi-user support, no public deployment.
- **Parts:**
  1. A **website** (`http://localhost:3192`) for managing listeners and reviewing
     and marking books.
  2. A **scheduler** running in the background. It runs the listeners on a
     schedule, records the books they find, and e-mails me about new ones.
- **Success:** after I add an author and sort their back catalogue once, I never
  have to check the stores manually. A new matching e-book reaches my inbox
  within one scheduler interval of appearing in a store.

### Core concepts

| Concept | Meaning |
|---|---|
| **Source** | A bookstore with its own search adapter: `adlibris` (adlibris.com/fi, EUR) and `bokus` (bokus.com, SEK). |
| **Listener** | One author plus the requirements I want to apply: language, format, price range (EUR) and the sources to search. One author normally maps to one listener because I read each author in one language. |
| **Book** | A unique title, deduplicated across sources by ISBN. |
| **Offer** | A book's listing on one source: URL, price and currency. A book has one offer per source. |
| **Seed** | A listener's first complete run. It records every existing book silently, without notifications. |
| **Book status** | `new` (a suggestion waiting for a decision), `accepted` (on my reading list), `read`, `rejected`. |

### User stories and acceptance criteria

**US-1 Manage listeners**
- I can create, edit, enable/disable and delete a listener on the website.
- Fields: display name, author name (the search query), language, format (default
  e-book), min price and max price in EUR (each optional), sources (one or both,
  at least one required).
- Input is validated: the author name is non-empty, prices are ≥ 0, and min ≤ max.
- A new listener starts in seed state `pending`.
- Deleting a listener keeps the books it found, along with their statuses.

**US-2 Seed a new listener**
- A listener in state `pending` is seeded in the next free scheduler slot (see
  US-6), ahead of any active listener that is due. I can also seed it right away
  with `npm run run-listener -- --listener <id>`.
- Seeding goes through **every page** of results on every selected source, then
  records each matching book with status `new`, flagged `found_during_seed`.
- **No e-mail is sent for books found during a seed.**
- A seed that fails on any source leaves the listener in state `pending` and
  records the error. It is retried when the listener is next due (US-6). A
  partially seeded listener never becomes `active`.
- Once the seed succeeds, the listener becomes `active` and `seeded_at` is set.
- The website shows seeded books under the listener. There I can bulk-mark them
  (select all, then *read*, *accepted* or *rejected*), because a seed can return
  dozens of books.

**US-3 Detect new books**
- When an enabled `active` listener is due (US-6), it searches its sources.
- A search result counts only if all of these hold:
  - the parsed author list contains the listener's author (a normalized,
    case- and diacritic-insensitive match), which filters out books that merely
    mention the author's name;
  - its format and language match the listener's;
  - its EUR price is within the listener's range.
- A book never seen before is stored with status `new` and queued for notification.
- A book already in the database, whether found by this listener or another, is
  not new. Its offer price and `last_seen_at` are updated and its status is left
  unchanged.
- A known book that is **outside** the price range is stored but not suggested.
  If its price later drops into range, it becomes a suggestion and triggers a
  notification once.

**US-4 Review and mark books**
- The **Suggestions** view lists books with status `new`: newest first, with
  cover, title, author, price per source with links, and the listener that found
  them.
- The **Reading list** view lists `accepted` books.
- The **Read** and **Rejected** views list books in those states.
- I can change a book from any status to any other, so I can change my mind. Each
  change sets `status_changed_at`.
- I can filter all views by listener/author.

**US-5 E-mail notifications**
- E-mail is turned on and off with `EMAIL_NOTIFICATIONS_ENABLED=true|false`
  (default `false`, so nothing is sent until I opt in).
- Finding a book never sends an e-mail straight away. It only queues the book
  (`notify_pending = true`), but only for books found by `active` listeners.
- **Daily digest:** once a day, at `DIGEST_TIME` local time (default `05:00`),
  the scheduler collects every queued book. If there is at least one, it sends
  one digest e-mail grouped by author. Each entry has the title, prices and
  links per source, and a link to the local website. With nothing queued, no
  e-mail is sent.
- **Catch-up:** the digest is *due* when the local time is past `DIGEST_TIME`
  and no digest has been completed for today. If the Mac was asleep or the
  scheduler wasn't running at 05:00, the digest goes out at the first scheduler
  wake-up after that, still at most once per day.
- A day's digest counts as completed when its status is `sent`, `mocked` or
  `empty`. A book queued after that waits for the next day's digest.
- Each book is notified **at most once**. `notified_at` is set and the queue
  flag cleared only after a successful send.
- A failed send keeps the books queued and is retried every 30 minutes that
  day. If it still hasn't succeeded, the books go into the next day's digest.
- With notifications disabled, books stay queued and no digest runs. When I
  enable notifications later, the first digest contains everything that was
  queued while they were off.
- `EMAIL_MOCK_MODE=true` logs the e-mail instead of sending it, and counts as
  a completed digest.
- `npm run digest -- [--force]` sends the digest right away (for testing).
  Without `--force`, it follows the once-a-day rule.

**US-6 Scheduler and rate limiting**

The stores must not be flooded with requests. Listeners run one at a time,
spread over the day.

- `npm run scheduler` starts a long-running process, which I start manually in
  a terminal. It wakes once a minute (`node-cron`, `* * * * *`). On each wake-up
  it:
  1. sends the daily digest if it is due (US-5);
  2. starts **at most one** listener run.

  Sending the digest never contacts the stores, so it doesn't wait for the gap
  between listener runs.
- **Once a day per listener:** a listener is *due* when `last_run_at` is null
  or at least `LISTENER_INTERVAL_HOURS` ago (default 24; values below 24 are
  rejected at startup).
- **Gap between runs:** a run starts only if at least `MIN_GAP_MINUTES`
  (default 30) plus a random jitter of 0–`GAP_JITTER_MINUTES` (default 10) have
  passed since the previous run of *any* listener ended. Listeners therefore
  never run back to back.
- **Picking order** among due listeners: `pending` seeds first, then the oldest
  `last_run_at`.
- **Failed runs count:** a failed or suspicious run still sets `last_run_at`. A
  store that is blocking us is not retried until the listener is next due.
- **Within a run:** sources are searched one after another. Page loads, both
  pagination and a switch to the next source, are 5–10 s apart. A run loads at
  most `MAX_PAGES_PER_SEARCH` pages per source (default 10).
- **Manual runs** (`npm run run-listener -- --listener <id>`) follow the same
  once-a-day and gap rules and refuse with a clear message when blocked.
  `--force` overrides the rules for debugging.
- **Capacity:** with the defaults, about 40 listeners fit in a day. The
  listeners page shows each listener's last and next expected run, and warns
  when the number of enabled listeners × average gap exceeds 24 hours.
- Runs never overlap. A wake-up during a run does nothing.
- The scheduler and manual runs share one lock (a Postgres advisory lock), so a
  manual run can't overlap a scheduled one either.
- Every listener-source search is recorded in `runs` with its status, number of
  books found and any error. The website shows the latest runs.
- **Suspicious-result guard:** if a source returns 0 results for a listener that
  previously had results on that source, the run is marked `suspicious` and
  logged, but nothing else changes. This catches parser breakage and bot blocks.

## Key technical decisions

1. **Fetching uses a headless browser (Playwright, Chromium).** Both stores
   currently answer plain HTTP requests with a *Vercel Security Checkpoint*
   (HTTP 429, a JavaScript challenge), which I verified on 2026-10-29. Each
   source adapter opens the store's search URL, waits for the result list, and
   extracts the data from the rendered DOM or from embedded JSON state if the
   page has it.
   **Proof of concept (2026-10-29):** headless Chromium (Playwright, headless
   shell) gets past the checkpoint on both sites with HTTP 200, and the rendered
   page includes the full result list. Bokus showed 27 of 27 Viveca Sten e-books
   and Adlibris 4 Heikki Hietala e-books, each with author, format, price and a
   product link that contains the ISBN-13 (`/bok/<isbn>/<slug>` on Bokus,
   `/fi/kirja/<slug>-<isbn>` on Adlibris). Both sites are Next.js apps
   (`self.__next_f`), and Adlibris also embeds JSON-LD.
2. **Polite scraping:** each listener runs at most once a day, with at least
   30 minutes (plus jitter) between any two listener runs, and 5–10 s between
   page loads within a run (US-6). The browser is launched for each run and
   closed afterwards. This is for personal use only.
3. **One listener, many sources.** Books are deduplicated by normalized ISBN
   (ISBN-13). If a result has no ISBN, the fallback key is
   `normalize(author) + normalize(title) + format`.
4. **Currency:** listener price ranges are in EUR. Bokus prices in SEK are
   converted with `SEK_TO_EUR` from `.env`. Offers store both the original price
   and the converted price.
5. **Search URL mapping per source.** The listener stores normalized values
   (`language: 'fi' | 'sv' | 'en' | …`, `format: 'ebook'`), and each adapter maps
   them to that store's facets:
   - Bokus: `https://www.bokus.com/search?q=<author>&facets=format:EBOOK,languageCodes:swe`
   - Adlibris: `https://www.adlibris.com/fi/haku?q=<author>&refinementList[language][0]=suomi&refinementList[format][0]=E-kirja`
6. **Migrations:** `node-pg-migrate` with plain SQL files, one per change, each
   with `-- Up Migration` and `-- Down Migration` sections, run by
   `src/scripts/migrate.ts`. This is the same setup as talokatsastus-api.
7. **Database access:** `pg` (node-postgres) with hand-written SQL in repository
   modules, no ORM. The website and the scheduler share the same repository code.
8. **E-mail:** the player-tracker design: a `Mailer` interface with Nodemailer
   (SMTP) and Resend implementations, selected by `EMAIL_PROVIDER`, plus
   `EMAIL_MOCK_MODE`. E-mail is turned on with `EMAIL_NOTIFICATIONS_ENABLED` and
   sent as a single daily digest at `DIGEST_TIME` (default 05:00, in the
   machine's local time zone).
9. **Runtime:** only Postgres runs in Docker. The website and the scheduler run
   on the host through npm scripts.

## Database schema (initial)

```sql
-- listeners: what to watch
CREATE TABLE listeners (
  id            bigserial PRIMARY KEY,
  name          text        NOT NULL,
  author        text        NOT NULL,              -- search query and match target
  language      text        NOT NULL,              -- normalized: 'fi', 'sv', 'en', ...
  format        text        NOT NULL DEFAULT 'ebook',
  min_price_eur numeric(10,2),
  max_price_eur numeric(10,2),
  sources       text[]      NOT NULL,              -- {'adlibris','bokus'}
  enabled       boolean     NOT NULL DEFAULT true,
  seed_state    text        NOT NULL DEFAULT 'pending'  -- pending | active
                CHECK (seed_state IN ('pending','active')),
  seeded_at     timestamptz,
  last_run_at   timestamptz,                      -- end of the last run, any outcome; drives the daily limit
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (min_price_eur IS NULL OR max_price_eur IS NULL OR min_price_eur <= max_price_eur)
);

-- books: one row per unique title/edition
CREATE TABLE books (
  id                bigserial PRIMARY KEY,
  dedupe_key        text        NOT NULL UNIQUE,   -- 'isbn:978...' or 'ta:<author>|<title>|<format>'
  isbn              text,
  title             text        NOT NULL,
  authors           text[]      NOT NULL,
  language          text,
  format            text        NOT NULL,
  cover_url         text,
  published_date    date,
  status            text        NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','accepted','read','rejected')),
  status_changed_at timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  eligible_at       timestamptz,                   -- first time it matched a listener's price range
  notify_pending    boolean     NOT NULL DEFAULT false,
  notified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- offers: a book's listing on a source
CREATE TABLE book_offers (
  id             bigserial PRIMARY KEY,
  book_id        bigint      NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source         text        NOT NULL,
  url            text        NOT NULL,
  price          numeric(10,2),
  currency       text,
  price_eur      numeric(10,2),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, source)
);

-- which listener found which book
CREATE TABLE listener_books (
  listener_id        bigint      NOT NULL REFERENCES listeners(id) ON DELETE CASCADE,
  book_id            bigint      NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  found_during_seed  boolean     NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listener_id, book_id)
);

-- run log: one row per listener x source search
CREATE TABLE runs (
  id           bigserial PRIMARY KEY,
  listener_id  bigint      REFERENCES listeners(id) ON DELETE SET NULL,
  source       text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('seed','watch')),
  status       text        NOT NULL CHECK (status IN ('running','ok','failed','suspicious')),
  results      integer,
  new_books    integer,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

-- daily digest attempts
CREATE TABLE notifications (
  id           bigserial PRIMARY KEY,
  digest_date  date        NOT NULL,              -- the local day this digest belongs to
  book_ids     bigint[]    NOT NULL DEFAULT '{}',
  status       text        NOT NULL CHECK (status IN ('sent','mocked','empty','failed')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- at most one completed digest per day; failed attempts may repeat
CREATE UNIQUE INDEX notifications_one_completed_per_day
  ON notifications (digest_date) WHERE status IN ('sent','mocked','empty');
```

Notification rule: `notify_pending` is set to `true` when a book first becomes
eligible (in range for a listener) through an `active` listener. Books found
during a seed never get the flag. The daily digest sends every book with the
flag. When the send succeeds, the flag is cleared and `notified_at` is set.

## Tech Stack

| Area | Choice |
|---|---|
| Language | TypeScript (strict), ESM |
| Package manager | npm |
| Website | React Router 8 in framework mode (SSR, loaders and actions). Verify the latest stable 8.x at setup. |
| Styling | Tailwind CSS |
| Scraping | Playwright (Chromium) |
| Database | PostgreSQL 17 (`postgres:17`) in Docker, host port **5499** |
| DB client | `pg` |
| Migrations | `node-pg-migrate` (SQL files) |
| Validation | `zod` (env, forms, parsed scraper output) |
| Scheduler | `node-cron` |
| E-mail | `nodemailer` and `resend` behind a `Mailer` interface |
| Script runner | `tsx` |
| Tests | `vitest` |
| Quality | ESLint (flat config, typescript-eslint), Prettier, `tsc --noEmit` |

## Commands

```bash
npm install && npx playwright install chromium   # first-time setup
npm run db:up            # docker compose up -d (Postgres 17 on :5499)
npm run db:down          # docker compose down
npm run db:migrate       # tsx src/scripts/migrate.ts up
npm run db:migrate:down  # tsx src/scripts/migrate.ts down (one step)
npm run db:migrate:create -- <name>   # node-pg-migrate create -m migrations -j sql

npm run dev              # React Router dev server on http://localhost:3192
npm run build            # react-router build
npm run start            # serve the production build on :3192

npm run scheduler        # long-running scheduler (rate-limited, see US-6)
npm run run-listener -- --listener <id> [--force]   # run (or seed) one listener now, rate limits apply
npm run search -- --source bokus --author "Viveca Sten" --language sv   # debug: print parsed results, no DB writes
npm run digest -- [--force]   # send today's digest now (once-a-day rule applies unless --force)
npm run test-email       # send a test e-mail

npm run lint             # eslint .
npm run lint:fix
npm run format           # prettier --check .
npm run format:fix       # prettier --write .
npm run typecheck        # react-router typegen && tsc --noEmit
npm test                 # vitest run (unit and parser fixture tests)
npm run test:db          # vitest run against the test database
npm run check            # lint + typecheck + test + format
```

## Project Structure

```
book-watcher/
├── app/                        # React Router website
│   ├── root.tsx
│   ├── routes.ts
│   ├── routes/                 # suggestions, reading-list, read, rejected, listeners, runs
│   └── components/
├── src/
│   ├── config.ts               # zod-validated env
│   ├── db/                     # pool + repositories (listeners, books, runs, notifications)
│   ├── sources/                # Source interface, adlibris.ts, bokus.ts, browser.ts
│   ├── watcher/                # runListener, seed logic, matching, dedupe, currency
│   ├── notifications/          # digest builder, Mailer + nodemailer/resend impls
│   └── scripts/                # migrate.ts, scheduler.ts, runListener.ts, search.ts, testEmail.ts
├── migrations/                 # node-pg-migrate SQL files
├── tests/fixtures/             # saved HTML/JSON from each store for parser tests
├── specs/                      # specs (this file)
├── docker-compose.yml
├── .env.example
└── package.json
```

`src/` code must not import from `app/`. The website imports repositories and
types from `src/`.

## Code Style

- TypeScript strict mode, ESM, named exports, no `any`.
- Prettier defaults with single quotes and print width 100. ESLint with
  typescript-eslint recommended rules plus `eslint-config-prettier`.
- Files are `camelCase.ts`; React components are `PascalCase.tsx`.
- Hand-written, parameterized SQL only. Never interpolate strings into SQL.
- Scraper output is validated with zod at the boundary, so parsing failures are
  loud.

```ts
export interface Source {
  id: SourceId;
  search(query: ListenerQuery, page: Page): Promise<SearchResult[]>;
}

export async function recordResults(
  db: Db,
  listener: Listener,
  results: SearchResult[],
  kind: 'seed' | 'watch',
): Promise<{ newBooks: number }> {
  const matching = results.filter((result) => matchesListener(listener, result));
  let newBooks = 0;
  for (const result of matching) {
    const { created } = await upsertBook(db, result, { notify: kind === 'watch' });
    if (created) newBooks++;
  }
  return { newBooks };
}
```

## Testing Strategy

- **Framework:** Vitest.
- **Parser tests (most important):** each source adapter's extraction logic is a
  pure function from page content to `SearchResult[]`. It is tested against
  saved fixtures in `tests/fixtures/<source>/`, captured with the `search` debug
  script. When a store changes its markup, I capture a new fixture and fix the
  parser.
- **Unit tests:** author matching and normalization, ISBN normalization and
  dedupe keys, price range checks, SEK→EUR conversion, digest e-mail content, and
  schedule parsing.
- **DB tests** (`*.dbtest.ts`, `npm run test:db`): repositories and the
  seed/watch/notify flow against a real Postgres test database
  (`book_watcher_test`). Covered: no notification during a seed, one
  notification per book, a failed send keeps books queued, a partial seed stays
  `pending`, and the suspicious-result guard.
- **No live-site tests in CI or `npm test`.** Live scraping is checked manually
  with `npm run search -- --live`.
- **Fixture-first parser development:** pages are captured once with
  `npm run capture`, stored in `tests/fixtures/<source>/`, and all parser work
  iterates against those files. Live requests during development are budgeted
  (a few per store) and logged in `tests/fixtures/<source>/CAPTURES.md`.
- **Website:** loader and action logic is tested as plain functions where it is
  non-trivial. UI is checked manually in the browser.

## Boundaries

- **Always:**
  - Run `npm run check` before calling a task done.
  - Write migrations in SQL with working up and down sections, and verify the
    down-then-up round trip.
  - Use parameterized queries.
  - Keep scraping polite (sequential requests with delays).
  - Keep secrets in `.env`, which is gitignored; `.env.example` lists the keys.
- **Ask first:**
  - Schema changes beyond this spec.
  - New dependencies not listed in the tech stack.
  - Adding a new source.
  - Changing the notification rules.
  - Any live request to a store beyond the fixture-capture budget. Use saved
    HTML instead.
- **Never:**
  - Commit `.env` or credentials.
  - Send real e-mails from tests.
  - Bypass the stores' protections by any means other than a normal browser
    session (no CAPTCHA solvers or proxy rotation).
  - Mark a listener `active` after a partial seed.
  - Delete books when a listener is deleted.

## Success Criteria

1. `npm run db:up && npm run db:migrate` creates the schema on Postgres 17 at
   `localhost:5499`, and `db:migrate:down` reverses it.
2. `npm run search -- --source bokus --author "Viveca Sten" --language sv` and
   the Adlibris equivalent (`--author "Heikki Hietala" --language fi`) print
   parsed e-book results with title, authors, ISBN, price and URL.
3. Creating a listener on `localhost:3192` and running the seed records all of
   that author's matching e-books from both sources as `new` suggestions, with no
   e-mail sent.
4. Bulk-marking the seeded books works, and they move to the correct views.
5. After the seed, a book that appears in a source (simulated in a DB test)
   is not e-mailed when it's found. It appears in exactly one daily digest at
   or after `DIGEST_TIME`, and later digests don't repeat it. A day with no
   queued books sends nothing. With `EMAIL_NOTIFICATIONS_ENABLED=false`,
   nothing is ever sent. (Covered by tests with a fake clock.)
6. A book listed on both stores is shown once, with two offers.
7. The scheduler never runs a listener more than once in 24 hours, and never
   starts two runs less than `MIN_GAP_MINUTES` apart (covered by unit tests
   with a fake clock). Each run is logged, and the website shows recent runs.
8. `npm run check` passes.

## Resolved Decisions (2026-10-29)

- **Price drops:** a known book that drops into a listener's price range
  triggers one notification.
- **Reading-list price drops:** not notified (out of scope).
- **Styling:** Tailwind CSS.
- **Adlibris locale:** always `adlibris.com/fi`, in EUR with Finnish facet
  labels.
- **Formats:** e-books only (the `format` column leaves room for more later).
- **Scheduler:** started manually in a terminal; no `launchd` agent.
- **Rate limiting:** each listener runs at most once a day, with listener runs
  spread out by a safe gap (US-6).
- **Notifications:** a daily digest at about 05:00, turned on and off with
  `EMAIL_NOTIFICATIONS_ENABLED`. Finding a book only queues it (US-5).
