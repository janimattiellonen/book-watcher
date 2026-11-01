# Spec: Book series

Status: **Accepted** (2026-10-31)
Date: 2026-10-31
Builds on: [`2026-10-29-book-watcher.md`](2026-10-29-book-watcher.md). Everything that spec
says still applies unless this one changes it.
Prompt: [`prompts/book-series.md`](../prompts/book-series.md)

## Objective

Many books are part of a series. Book Watcher records which series a book belongs to
and its part number, and the website groups books by series. That makes a long back
catalogue easier to browse and shows which parts of a series I have read or am
missing.

- **User:** me, as before. It's a single-user local tool.
- **Success:** on any book view, the parts of a series sit together in part order.
  Each series has a page listing its known parts with their status, and the gaps.
  It costs the stores at most a few extra page loads per listener run.

### Where the data comes from (checked against the saved pages, 2026-10-31)

| Store    | Search results page                                                                                                                                                                                                                                                  | Book page                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Bokus    | Most cards that belong to a series show it, e.g. `<div class="product-list-series …"><span>Del 7 - Åremorden</span></div>`. That is 21 of the 27 Viveca Sten results, and 3 cards across the two Astrid Lindgren pages ("Del 2 - Dunne", "Del 1 - Johnny &amp; Co"). | "Del 1 i serien Sam Berger och Molly Blom". Not needed. |
| Adlibris | No series on the cards. The page only has a "Sarja" filter facet.                                                                                                                                                                                                    | "Sarja: Hildur-serien (osa 01)"                         |

So Bokus series come free with the searches we already make. Adlibris series need
one extra page load per book. Not every book is in a series, and not every series
book is labelled as one (e.g. most of the Astrid Lindgren results).

### Core concepts (additions)

| Concept           | Meaning                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Series**        | A named sequence of books, e.g. "Morden i Sandhamn". Identified by its author and normalized name (see decision 3). |
| **Part**          | A book's number in its series. It's a number, may be missing, and may be fractional ("Del 2.5").                    |
| **Series lookup** | Loading one Adlibris book page to read its series. Each book is looked up at most once, successfully.               |

### User stories and acceptance criteria

**US-S1 Record series from Bokus searches**

- The Bokus parser reads the series label on each result card. `Del <n> - <name>`
  gives the part and the name. Any other non-empty label gives the name with no part.
- The listener run stores it on the book (decision 4), on seeds and watch runs alike,
  for new and known books. So books already in the database get their series on
  their listener's next run, with no extra requests.
- A card without a label changes nothing.

**US-S2 Look up series on Adlibris book pages**

- After a listener's searches, the run looks up books that meet all of these:
  - they're linked to this listener;
  - they have an Adlibris offer;
  - they have no series yet;
  - they've never been looked up successfully.
- Newest first (`listener_books.first_seen_at` descending), at most
  `MAX_SERIES_LOOKUPS_PER_RUN` (default 20) per run, with the usual 5–10 s
  pause before each page load. The rest wait for the listener's next run, so a big
  seed's lookups spread over a few days.
- The Adlibris book page's `Sarja: <name> (osa <n>)` gives the name and part.
  `Sarja: <name>` with no `(osa …)` gives the name with no part. A page with no
  "Sarja" line is a successful lookup that found no series.
- A successful lookup sets `books.series_checked_at`, whether or not it found a
  series, so the book is never loaded again.
- If a lookup fails, the book is left unmarked and retried on a later run. A
  `BlockedError` ends the lookups for this run.
- The lookups are logged as their own `runs` row: `kind = 'series'`,
  `source = 'adlibris'`, `results` = pages loaded, `new_books` = series found.
  The row shows on `/runs` like the others.
- Lookups never decide a seed's outcome. The listener is activated on its searches
  alone, as today. They never queue a notification or change a book's status.
- A listener that doesn't search Adlibris does no lookups.

**US-S3 Group books by series in the book views and on the listener page**

- Books from the same series sit together under one series heading, which links to
  the series page. This applies:
  - in Suggestions, Reading list, Read and Rejected, among the books in that view;
  - on the listener page, within each of its two sections ("Found during the seed"
    and "Found since").
- On the listener page's bulk form, each book in a group keeps its own checkbox, and
  "Select all" still ticks every book in the section.
- Within a group, books are in part order. Books without a part come last, by title.
- A group takes the position its first member would have in the view's normal
  order, so the newest activity still comes first. Books without a series are
  listed as today.
- Each book card in a series shows "Part 3 · <series>", or just "<series>" when the
  part is unknown. The series name links to the series page.
- The listener filter keeps working, and grouping applies to the filtered list.

**US-S4 Series page** (`/series/:id`)

- Shows the series name, and every book in the database in that series, in part
  order, with the usual book card and status buttons.
- Lists the gaps: whole part numbers missing between 1 and the highest known part,
  e.g. "Part 4: not in Book Watcher". Parts after the highest known one can't be
  seen, so they're never listed.
- Under the gaps, one note: "Missing parts may not be sold as e-books in this
  language, may not be out yet, or may not be marked with the series in the store."
- When some of the series author's books are still waiting for a series lookup, the
  page also says "3 books by this author are still waiting for a series lookup". A
  waiting book has the series's author as its first author, has an Adlibris offer,
  no series, and no successful lookup. So a gap that may still fill itself in is
  told apart from one that won't.
- Links to the listeners whose books are in the series.
- An unknown id is a 404.

**US-S5 Series list and filter** (`/series`)

- Lists every series that has at least one book, sorted by name. Each row shows the
  number of books in each status, linked to the series page.
- The four book views accept `?series=<id>` like `?listener=<id>`, and the two
  combine. A series filter shows only that series's books, still in part order.
- The site navigation gets a "Series" link.

**US-S6 E-mail digest unchanged**

- The digest's content, rules and timing don't change. (Decided 2026-10-31.)

## Key technical decisions

1. **Bokus from search results, Adlibris from book pages.** Bokus book pages are
   never loaded: the search cards already show the series. Adlibris book pages are
   the only new kind of request.
2. **Lookups ride along with listener runs.** They reuse the run's browser, after its
   searches, and fall under the same rate limits: one listener run at a time, the gap
   between runs, and 5–10 s between page loads. They add no scheduler job, so the
   daily limit and the gap still bound all traffic. The per-run cap bounds the extra
   load: at most `MAX_SERIES_LOOKUPS_PER_RUN` pages, about 2–4 minutes at the
   default. The capacity estimate (US-6 of the base spec) already counts a run's
   real duration, so slower runs show up in it.
3. **A series is identified by its author and its normalized name.** The author is
   the book's first author, normalized as for the ISBN-less dedupe key. Normalizing
   the name means:
   - case-fold and trim;
   - fold diacritics and replace punctuation with spaces, as for author names;
   - collapse whitespace;
   - drop a trailing "-serien", " serien", "-sarja" or " sarja", unless that word is
     the whole name;
   - decode HTML entities.

   So Adlibris's "Hildur-serien" and a Bokus "Hildur" by Satu Rämö become one series.
   Two authors' series that share a name ("Hildur", or a generic one like "Trilogin")
   stay apart. The display name is the first name seen. Accepted risk: a series whose
   books list different first authors, e.g. co-authors in a varying order, splits in
   two. (Decided 2026-10-31; the diacritic and punctuation folding added 2026-11-01.)

4. **One series per book.** A book's series and part come from:
   - Bokus, whenever a Bokus card shows one. This overwrites an Adlibris value,
     because Bokus is read on every run at no cost.
   - Adlibris, only when the book has no series.

   The source is stored, so this rule can be applied.

5. **Part numbers are `numeric`**, so "2.5" fits. `osa 01` reads as 1.
6. **No manual editing.** Series come from the stores only. Correcting them by hand
   is out of scope for this spec.

## Database schema (additions)

One migration:

```sql
CREATE TABLE series (
  id          bigserial   NOT NULL,
  name        text        NOT NULL,              -- display name, the first seen
  name_key    text        NOT NULL,              -- normalized name, decision 3
  author      text        NOT NULL,              -- display form of the first author
  author_key  text        NOT NULL,              -- normalized first author, decision 3
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT series_pkey PRIMARY KEY (id),
  CONSTRAINT uq_series_author_name UNIQUE (author_key, name_key)
);

ALTER TABLE books
  ADD COLUMN series_id         bigint,
  ADD COLUMN series_part       numeric(6,2),
  ADD COLUMN series_source     text,
  ADD COLUMN series_checked_at timestamptz,      -- last successful Adlibris lookup
  ADD CONSTRAINT fk_books_series FOREIGN KEY (series_id) REFERENCES series (id),
  ADD CONSTRAINT ck_books_series_source CHECK (series_source IN ('adlibris', 'bokus')),
  ADD CONSTRAINT ck_books_series_consistent
    CHECK ((series_id IS NULL) = (series_source IS NULL)
           AND (series_part IS NULL OR series_id IS NOT NULL));

CREATE INDEX ix_books_series_id ON books (series_id);

ALTER TABLE runs DROP CONSTRAINT ck_runs_kind,
  ADD CONSTRAINT ck_runs_kind CHECK (kind IN ('seed', 'watch', 'series'));
```

`trg_series_set_updated_at` is added the same way as on the other tables. The down migration
reverses all of it, and deletes any `kind = 'series'` runs first so the old check
can be restored.

A series with no books left is never shown (US-S5), and isn't deleted
automatically.

## Configuration (additions)

| Key                          | Default | Meaning                                                           |
| ---------------------------- | ------- | ----------------------------------------------------------------- |
| `MAX_SERIES_LOOKUPS_PER_RUN` | 20      | Adlibris book pages loaded per listener run. 0 turns lookups off. |

## Commands

As in the base spec. Two changes:

- `npm run search -- --source bokus --fixture <file>` prints a `series` column.
- `npm run series-lookup -- --fixture <file>` prints what the Adlibris book-page
  parser makes of a saved page. With `--url <adlibris book url> --live`, it loads
  one page live; that's one real request.

## Project Structure (additions)

```
migrations/<ts>_add-series.sql
src/sources/series.ts            # label parsing and name normalization (pure)
src/sources/adlibrisBook.ts      # Adlibris book-page parser
src/db/series.ts                 # series upsert, book series updates, lookup queue, series queries
src/watcher/seriesLookup.ts      # the per-run lookup step
src/scripts/seriesLookup.ts      # the debug CLI
app/routes/series.tsx            # /series
app/routes/seriesDetail.tsx      # /series/:id
app/lib/seriesGroups.ts          # grouping a view's books by series (pure)
tests/fixtures/adlibris/book-*.html
```

`/series` is declared before the `:view` route in `app/routes.ts`. React Router ranks
static segments above dynamic ones anyway, and a route test pins it.

## Code Style

As in the base spec: strict TypeScript, ESM, parameterized SQL in repository
modules, and zod for parsed scraper output. The parsers and the grouping are pure
functions with unit tests, and the database code has DB tests.

## Testing Strategy

- **Unit:**
  - Bokus label parsing (`Del 7 - Åremorden`, `Del 2.5 - X`, a label with no part,
    `&amp;` in the name).
  - Name normalization, including "Hildur-serien" and "Hildur" giving the same key, and the same name by two authors giving two keys.
  - The Adlibris book-page parser against the captured fixtures: one page in a
    series, one with a part, one without a series.
  - View grouping and ordering, also within the listener page's two sections.
  - Gap computation, and the count of books waiting for a lookup.
- **Parser regression:** the existing Bokus fixtures give the expected series for
  all 21 Viveca Sten series cards, and no series for the cards without a label.
- **DB tests:**
  - series upsert by author and name key;
  - the source precedence rule (decision 4);
  - the lookup queue's selection, order and cap;
  - `series_checked_at` set on success, including when no series was found, and
    left unset on failure;
  - a seed is activated even when its lookups fail;
  - lookups never set `notify_pending`;
  - the migration's down/up round trip.
- **Run tests with fakes:** a fake source search plus a fake book-page loader. Check
  the lookup `runs` row, that a `BlockedError` stops the lookups, and that a cap of 0
  turns them off.
- **Loader tests:** `?series=` and `?listener=` together, and a 404 for an unknown
  series.

## Boundaries

All of the base spec's boundaries still apply. In addition:

- **Always:**
  - Look up a book at most once successfully.
  - Keep lookups inside a listener run, after its searches, with the polite delay.
  - Develop the Adlibris book-page parser against saved pages.
- **Ask first:**
  - Any live request beyond the capture budget below.
  - Raising the default `MAX_SERIES_LOOKUPS_PER_RUN`.
  - Loading Bokus book pages.
  - Adding manual series editing.
  - Changing the digest.
- **Never:**
  - Run lookups outside a listener run, or in parallel.
  - Let a lookup failure fail a search run or block a seed.
  - Change a book's status or notification flags from series code.

**Capture budget:** at most 4 live Adlibris book-page loads, logged in
`tests/fixtures/adlibris/CAPTURES.md`:

- Hildur, part 1;
- Tinna, part 5;
- one book with no series: _Jäniksen vuosi_ by Arto Paasilinna;
- one retry.

## Success Criteria

1. The migration's down/up round trip works on `book_watcher_test`.
2. `npm run search -- --source bokus --fixture tests/fixtures/bokus/search-viveca-sten-sv-ebook.html`
   shows a series for the 21 labelled results: "Morden i Sandhamn" parts 1–11,
   "Åremorden" parts 1–7 and "Havsfolket" parts 1–3.
3. `npm run series-lookup -- --fixture <file>` parses the captured Adlibris pages.
   Hildur gives "Hildur-serien", part 1. Tinna gives part 5. _Jäniksen vuosi_ gives
   no series.
4. After the Viveca Sten listener's next run, its books show grouped by series in
   the book views and on `/series`, with no more requests than a normal run
   plus the capped lookups.
5. A series page shows parts in order, with each status, and lists the gaps.
6. Lookups appear on `/runs`, and never exceed the cap per run.
7. The digest is unchanged: existing digest tests pass untouched.
8. `npm run check` and `npm run test:db` pass.

## Resolved Decisions (2026-10-31)

- **Gap wording:** "Part 4: not in Book Watcher", one note on why parts can be
  missing, and a count of the author's books still waiting for a lookup (US-S4).
- **Adlibris series:** from book pages, one lookup per book, capped per run.
- **Website:** grouping within the book views and on the listener page, a series
  page, and a series list with a filter.
- **No re-checking:** a book whose lookup found no series is never looked up again.
  If that turns out to miss series, it can be revisited then.
- **E-mail:** the digest is unchanged.
- **Series identity:** the author plus the series name (decision 3).
