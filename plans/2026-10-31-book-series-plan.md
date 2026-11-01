# Implementation Plan: Book series

Spec: [`specs/2026-10-31-book-series.md`](../specs/2026-10-31-book-series.md)
Status: **Accepted** (2026-10-31)

## Overview

Record each book's series and part number, and group books by series on the
website. There are two data paths:

- **Bokus:** the series label on each search card, read by the parser we already
  run. This costs no extra requests.
- **Adlibris:** one book-page load per book, run as a capped lookup step at the end
  of a listener run.

The UI work then groups books by series in the book views and on the listener page,
and adds a series list and a series page.

The order follows the base plan: data first, then the parsers against saved pages,
then the run pipeline, then the UI. The one new kind of live request, an Adlibris
book page, is captured once early (T4), so the parser is built on saved HTML.

## Architecture Decisions

- **Parsing is pure.**
  - `src/sources/series.ts` parses both stores' labels and normalizes the keys.
  - `src/sources/adlibrisBook.ts` parses a saved book page.
  - Neither touches the network or the database.
- **`SearchResult` gains `series: { name, part } | null`.** Bokus fills it in.
  Adlibris search results always give `null`. The book-page lookup is a separate path.
- **The lookup step has injectable dependencies,** like `runListener`:
  - a `loadBookPage(url)` function, which `withLiveSearch` provides from the run's
    browser;
  - the clock, the pause and the DB.

  So its rules are DB-tested with fakes.

- **Grouping is a pure function** (`app/lib/seriesGroups.ts`) over an already-ordered
  book list. The repository queries stay as they are, apart from returning the
  series fields. That keeps the view order rules in one place.
- **Lookup `runs` rows stay out of the search statistics.**
  - `hadResultsBefore` ignores `kind = 'series'`, so a lookup row with results
    can't hide a suspicious Adlibris search.
  - `averageRunSeconds` measures searches only.
  - The capacity estimate adds the average lookup-row duration for each listener
    that searches Adlibris.

  This corrects spec decision 2, which assumed the existing estimate already
  covered lookups.

## Dependency Graph

```
T1 migration ──┬──────────────► T5 repositories ──► T6 run pipeline ──► T7 grouping UI ──► T8 series pages ──► T9 docs
T2 series.ts ──┼─► T3 Bokus ───┘                      ▲
               └─► T4 Adlibris book page ─────────────┘
```

T2 to T4 can be done in parallel with T1. T7 can start once T5 returns the series
fields.

## Task List

### Phase 1: Data and parsers

#### Task 1: Series migration

**Description:** One migration, exactly as in the spec's schema section:

- a `series` table, unique on `(author_key, name_key)`;
- the four `books.series_*` columns, with their FK, checks and index;
- the `updated_at` trigger;
- `ck_runs_kind` widened to include `'series'`.

The down migration deletes `kind = 'series'` runs, then reverses everything.

**Acceptance criteria:**

- [ ] `npm run db:migrate` applies it. `db:migrate:down` followed by `db:migrate`
      round-trips on `book_watcher_test`.
- [ ] The DB schema test covers:
  - a series is unique per author and name;
  - `ck_books_series_consistent` rejects a part without a series, and a series
    without a source;
  - `runs.kind = 'series'` is accepted.

**Verification:** `npm run test:db`, plus the down/up round trip.

**Dependencies:** none

**Files likely touched:** `migrations/<ts>_add-series.sql`, `src/db/schema.dbtest.ts`

**Estimated scope:** S

#### Task 2: Series label parsing and normalization

**Description:** Pure functions in `src/sources/series.ts`:

- `parseBokusSeriesLabel`: `Del <n> - <name>`, or any non-empty label as a name
  with no part.
- `parseAdlibrisSeriesLabel`: `<name> (osa <n>)`, or `<name>`.
- `seriesNameKey`:
  - case-fold, trim and collapse whitespace;
  - strip a trailing `-serien`, ` serien`, `-sarja` or ` sarja`;
  - entities are decoded by cheerio before the label gets here (checked in T3).
- `seriesAuthorKey`: the book's first author, through the existing `normalizeName`.

Part numbers are parsed as numbers: `01` is 1, and `2.5` or `2,5` is 2.5.

**Acceptance criteria:**

- [ ] `Del 7 - Åremorden` gives `{ name: 'Åremorden', part: 7 }`.
- [ ] `Hildur-serien (osa 01)` gives `{ name: 'Hildur-serien', part: 1 }`.
- [ ] "Hildur-serien" and "Hildur" give the same name key.
- [ ] The same name by two authors gives two different `(author_key, name_key)`
      pairs.

**Verification:** `npm test -- series`

**Dependencies:** none

**Files likely touched:** `src/sources/series.ts`, `src/sources/series.test.ts`

**Estimated scope:** S

#### Task 3: Bokus parser reads the series

**Description:** `parseBokus` reads `.product-list-series span` on each card into the
new `SearchResult.series` field, and `parseAdlibris` sets it to `null`.
`npm run search` prints a `series` column.

**Acceptance criteria:**

- [ ] On `search-viveca-sten-sv-ebook.html`, 21 results have a series:
  - "Morden i Sandhamn" parts 1–11;
  - "Åremorden" parts 1–7;
  - "Havsfolket" parts 1–3.

  The other 6 have `null`. (Spec success criterion 2.)

- [ ] The Astrid Lindgren fixtures give "Dunne" part 2 and "Johnny & Co" part 1. The
      fixture has `Johnny &amp; Co`, so this also checks that entities are decoded.
- [ ] All existing parser tests still pass.

**Verification:** `npm test -- bokus adlibris`, plus `npm run search -- --source bokus --fixture …`

**Dependencies:** T2

**Files likely touched:** `src/sources/types.ts`, `src/sources/bokus.ts`, `src/sources/bokus.test.ts`, `src/sources/adlibris.ts`, `src/scripts/search.ts`

**Estimated scope:** S

#### Task 4: Adlibris book-page capture, parser and `series-lookup` CLI

**Description:**

- Capture the Adlibris book pages with the existing `capture --url`, logged in
  `CAPTURES.md`:
  - Hildur (osa 01);
  - Tinna (osa 05);
  - one Heikki Hietala book with no series.

  That's at most 4 live loads, including one retry. **I'll confirm with you before
  the captures.** If `capture` only fits search pages, give it a book-page mode.

- `parseAdlibrisBook(html)` returns `{ series: { name, part } | null }`. It throws
  `BlockedError` on the checkpoint, and `UnexpectedPageError` when the page isn't a
  book page.
- `npm run series-lookup -- --fixture <file>`, or `--url <url> --live` for one real
  request.

**Acceptance criteria:**

- [ ] Hildur gives "Hildur-serien" part 1, Tinna part 5, and the Hietala book `null`.
      (Spec success criterion 3.)
- [ ] The saved checkpoint page throws `BlockedError`.
- [ ] No more than 4 live loads, all logged.

**Verification:** `npm test -- adlibrisBook`, plus `npm run series-lookup -- --fixture …`

**Dependencies:** T2

**Files likely touched:** `src/sources/adlibrisBook.ts`, `src/sources/adlibrisBook.test.ts`, `src/scripts/seriesLookup.ts`, `src/scripts/capture.ts`, `tests/fixtures/adlibris/book-*.html`, `tests/fixtures/adlibris/CAPTURES.md`, `package.json`

**Estimated scope:** M

### Checkpoint 1: Data and parsers

- [ ] `npm run check` and `npm run test:db` pass.
- [ ] Both stores' series parse correctly from saved pages.

### Phase 2: Run pipeline

#### Task 5: Repositories

**Description:** `src/db/series.ts`:

- `upsertSeries(author, name)`: returns the id, keeping the first display name.
- `applyBookSeries(bookId, { name, part }, source)`: applies spec decision 4. Bokus
  always writes. Adlibris writes only when the book has no series.
- `listLookupQueue(listenerId, limit)`: the listener's books that have an Adlibris
  offer, no series and no successful lookup. Newest link first.
- `markSeriesChecked(bookId, now)`.
- `listSeries()`: every series with books, with counts per status.
- `getSeries(id)`, and `countWaitingLookups(authorKey)` for the series page.

In `src/db/books.ts`:

- `Book` gains `seriesId`, `seriesName` and `seriesPart`;
- `listBooks` and `listListenerBooks` return them;
- `BookListFilter` gains `seriesId`.

In `src/db/runs.ts`:

- `RunKind` gains `'series'`;
- `hadResultsBefore` and `averageRunSeconds` skip series rows;
- a new `averageSeriesLookupSeconds`.

**Acceptance criteria:**

- [ ] DB tests cover:
  - the upsert by author and name;
  - the precedence rule in both directions;
  - the queue's selection, order and limit;
  - `markSeriesChecked`;
  - the per-status counts;
  - the `seriesId` filter combined with `listenerId`;
  - the waiting count.
- [ ] A series row with results does not make `hadResultsBefore` true for Adlibris.

**Verification:** `npm run test:db`

**Dependencies:** T1, T2

**Files likely touched:** `src/db/series.ts`, `src/db/series.dbtest.ts`, `src/db/books.ts`, `src/db/books.dbtest.ts`, `src/db/runs.ts`, `src/db/runs.dbtest.ts`

**Estimated scope:** M

#### Task 6: Series in the listener run

**Description:**

- `recordResults` applies a result's Bokus series to new and known books alike, on
  seeds and watch runs.
- A new `src/watcher/seriesLookup.ts` runs after the searches, when the listener
  searches Adlibris and `MAX_SERIES_LOOKUPS_PER_RUN > 0`:
  1. take the queue, up to the cap;
  2. for each book, pause, load the Adlibris offer URL and parse it, then apply and
     mark the book;
  3. on a `BlockedError`, stop;
  4. on any other error, leave that book for a later run and continue;
  5. record a `kind = 'series'` row: `results` = pages loaded, `new_books` = series
     found, and the status `failed` if it stopped on a block.
- The listener is activated on its searches alone, before the lookups, so a lookup
  failure can't block a seed.
- `withLiveSearch` passes a book-page loader using the run's browser.
- New config key `MAX_SERIES_LOOKUPS_PER_RUN` (default 20, 0 turns lookups off), also
  added to `.env.example`.
- `scheduleCapacity` adds the average lookup duration for each listener that
  searches Adlibris.

**Acceptance criteria:**

- [ ] DB tests with a fake search and a fake page loader cover:
  - Bokus series are stored on a seed and on a watch run;
  - the cap is honoured;
  - a block stops the lookups;
  - a failed page leaves the book unmarked;
  - a page with no series marks the book checked;
  - the seed is activated even when every lookup fails;
  - no lookup sets `notify_pending` or changes a status;
  - a listener without Adlibris, or with the cap at 0, does no lookups and records
    no series row.
- [ ] `capacity.test.ts` covers the added lookup time.
- [ ] The scheduler and `run-listener` work unchanged, and the run lock covers the
      lookups.

**Verification:** `npm test` and `npm run test:db`

**Dependencies:** T3, T4, T5

**Files likely touched:** `src/watcher/runListener.ts`, `src/watcher/seriesLookup.ts`, `src/watcher/seriesLookup.dbtest.ts`, `src/watcher/liveSearch.ts`, `src/watcher/capacity.ts`, `src/config.ts`, `.env.example`, `app/routes/listeners.tsx`

**Estimated scope:** M

### Checkpoint 2: Pipeline end to end

- [ ] `npm run check` and `npm run test:db` pass.
- [ ] **With your OK, one live run** of the Viveca Sten listener
      (`run-listener --force`). Afterwards:
  - its books have series from Bokus;
  - a series row appears on `/runs`, with at most 20 page loads;
  - nothing is queued for the digest.

### Phase 3: Website

#### Task 7: Grouping in the book views and on the listener page

**Description:**

- `app/lib/seriesGroups.ts` turns an ordered book list into a list of items, each a
  single book or a series group:
  - a group sits where its first member would;
  - within a group, books are in part order, and books without a part come last, by
    title.
- `BookCard` shows "Part 3 · <series>" (or "<series>"), with the series name linked
  to the series page.
- The four book views and the listener page's two sections render the groups. The
  listener page's bulk form keeps one checkbox per book, and "Select all" still
  ticks every book in the section.

**Acceptance criteria:**

- [ ] Unit tests cover:
  - group placement;
  - order within a group;
  - books without a part;
  - books without a series, which stay where they were.
- [ ] On the dev server, the Viveca Sten books show grouped in Suggestions, Read and
      on the listener page.
- [ ] Bulk-marking a whole group still marks every book.

**Verification:** `npm test`, plus a look on `localhost:3192` (browser check)

**Dependencies:** T5 (and real series data from Checkpoint 2 for the browser check)

**Files likely touched:** `app/lib/seriesGroups.ts`, `app/lib/seriesGroups.test.ts`, `app/components/BookCard.tsx`, `app/components/SeriesGroup.tsx`, `app/components/BulkStatusForm.tsx`, `app/routes/books.tsx`, `app/routes/listenerDetail.tsx`

**Estimated scope:** M

#### Task 8: Series list, series page and series filter

**Description:**

- `/series` lists every series with books, sorted by name, with counts per status.
- `/series/:id` shows:
  - the series' books in part order, with their status buttons;
  - the gaps, as "Part 4: not in Book Watcher", followed by the note from US-S4;
  - the waiting-lookup count, when it is above zero;
  - links to the listeners whose books are in the series.

  An unknown id is a 404.

- The four book views accept `?series=<id>`, which combines with `?listener=`.
- The navigation gets a "Series" link.
- The `/series` routes are declared before `:view`, and a route test pins it.

**Acceptance criteria:**

- [ ] Unit tests cover the gap computation: a part 2.5 doesn't count as a gap, and
      nothing beyond the highest part is listed.
- [ ] Loader tests cover:
  - the 404;
  - the series filter;
  - the series filter combined with the listener filter.
- [ ] The route test shows `/series` isn't taken by the `:view` route.
- [ ] Browser check: a series page shows its parts, gaps and note. (Spec success
      criterion 5.)

**Verification:** `npm test`, `npm run test:db`, plus a browser check

**Dependencies:** T5, T7

**Files likely touched:** `app/routes.ts`, `app/routes.test.ts`, `app/routes/series.tsx`, `app/routes/seriesDetail.tsx`, `app/lib/seriesGaps.ts`, `app/lib/seriesGaps.test.ts`, `app/routes/books.tsx`, `app/lib/bookViews.ts`, `app/root.tsx`

**Estimated scope:** M

### Phase 4: Polish

#### Task 9: README and final verification

**Description:** Update the README:

- series on the website;
- what lookups cost;
- the new setting;
- the `series-lookup` command;
- troubleshooting a lookup that was blocked.

Then go through the spec's success criteria and record the evidence for each, as
under Task 16 of the base plan.

**Acceptance criteria:**

- [ ] The README matches the code, checked against the source.
- [ ] Every success criterion in the spec is checked off, with evidence.

**Verification:** `npm run check`, `npm run test:db`

**Dependencies:** All

**Files likely touched:** `README.md`, `plans/2026-10-31-book-series-plan.md`

**Estimated scope:** S

**Final verification (2026-11-01):**

- README: series on the website, a Series section on where series come from and what
  the lookups cost, `MAX_SERIES_LOOKUPS_PER_RUN` under Settings, the `series-lookup`
  commands under Development, and a failed `series` run under Troubleshooting. Each
  point was checked against `seriesLookup.ts`, `runListener.ts`, `config.ts`,
  `politeDelay` and the two scripts.
- `npm run check`: 155 tests pass. `npm run test:db`: 104 tests pass.

The spec's success criteria:

1. **Migration.** On `book_watcher_test`, `db:migrate:down` removed the `series` table
   and the four `books.series_*` columns, leaving `add-notifications-table` as the
   latest migration; `db:migrate` put them back.
2. **Bokus series.** The spec's command on the saved Viveca Sten page parses 27
   results, 21 with a series: "Morden i Sandhamn" parts 1–11, "Åremorden" parts 1–7 and
   "Havsfolket" parts 1–3.
3. **Adlibris book pages.** `series-lookup --fixture` gives "Hildur-serien", part 1 for
   Hildur, part 5 for Tinna, and no series for _Jäniksen vuosi_. That page stands in
   for the Hietala book, which was not captured (T4).
4. **Listener run.** The Viveca Sten listener's watch run (Checkpoint 2, 2026-11-01)
   made its two normal searches (Adlibris 64 results, Bokus 27, both `ok`) plus 3
   Adlibris book pages, under the cap. Its books show grouped by series in the book
   views and on the listener page, and on `/series`. Tests: `seriesGroups.test.ts`.
5. **Series page.** `/series/6` shows Morden i Sandhamn parts 1–11 in order with their
   statuses. A temporary book as Åremorden part 9 showed "Part 8: not in Book Watcher"
   and the note; it was deleted afterwards. Tests: `seriesGaps.test.ts`,
   `seriesDetail.test.ts`.
6. **Runs and the cap.** The lookups are run 9 on `/runs`, `kind` series, 3 results.
   Test: `seriesLookup.dbtest.ts`, "loads at most the cap per run, and never looks a
   book up twice".
7. **Digest.** No digest or e-mail code changed. The digest tests' assertions are
   untouched; `sendDailyDigest.dbtest.ts` got one line, `series: null` in its result
   builder, because `SearchResult` gained the field (T3). Those tests pass.
8. **`npm run check` and `npm run test:db`** pass, as above.

## Risks and Mitigations

| Risk                                                                             | Impact | Mitigation                                                                                                                                |
| -------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The Adlibris book page differs from what the prompt shows, or is client-rendered | Med    | T4 captures real pages before any parser work. `UnexpectedPageError` fails loudly.                                                        |
| Book-page loads trip Adlibris's bot protection more than searches do             | Med    | At most 20 loads per run, at the polite delay. A `BlockedError` stops the lookups at once. Failed lookups are retried only on later runs. |
| Bokus and Adlibris name a series differently beyond the "-serien" suffix         | Low    | Accept a split series, as for ISBN-less duplicates. Revisit with real examples.                                                           |
| A series' books list different first authors                                     | Low    | Accepted in the spec (decision 3).                                                                                                        |
| Lookup time pushes the schedule past capacity                                    | Low    | The capacity estimate includes lookups (T6), so the listeners page warns. `MAX_SERIES_LOOKUPS_PER_RUN` can be lowered.                    |

## Open Questions

- None for now. The spec's open questions were all resolved on 2026-10-31.
