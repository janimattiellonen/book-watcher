# Spec: Publication year

Status: **Accepted** (2026-11-02)
Date: 2026-11-02
Builds on: [`2026-10-29-book-watcher.md`](2026-10-29-book-watcher.md) and
[`2026-10-31-book-series.md`](2026-10-31-book-series.md).

## Objective

Each book card shows the year the book came out, so the newest books stand out.

## Where the year comes from (checked against the saved pages, 2026-11-02)

| Page                    | Year                                          | Loaded                             |
| ----------------------- | --------------------------------------------- | ---------------------------------- |
| Bokus search results    | "E-bok · Svenska, 2026"                       | Every run                          |
| Adlibris search results | None: the format is followed by the price     | Every run                          |
| Adlibris book page      | "E-kirja, 2026", and "Julkaisupäivä" (a date) | Only for the series lookup (US-S2) |
| Bokus book page         | Yes                                           | Never (loading it stays ask-first) |

No page is loaded to find a year. A book only Adlibris sells gets a year only when
its series lookup loads its book page.

## Behaviour

- The Bokus parser reads the year from the card's format row. A card without one
  gives no year.
- A listener run stores the year on the book, for new and known books alike. A newer
  non-empty year replaces the stored one; an empty one never clears it.
- A series lookup that reads an Adlibris book page stores the page's year, the year
  of its "Julkaisupäivä", when the book has none yet. It never changes a book's status
  or notification flags, as before.
- The book card shows "Published 2026". A book without a year shows nothing.
- Nothing else uses the year: no sorting, filtering or digest change.

## Schema

One migration replaces the unused `books.published_date date` (empty for every
book) with `books.published_year smallint`, checked to be between 1400 and 2200 when
set. The down migration reverses it; the years are lost, the dates were never set.

## Success criteria

1. The migration's down/up round trip works on `book_watcher_test`.
2. `npm run search -- --source bokus --fixture tests/fixtures/bokus/search-viveca-sten-sv-ebook.html`
   prints a year for each Viveca Sten result.
3. `npm run series-lookup -- --fixture tests/fixtures/adlibris/book-hildur.html`
   prints the year of Hildur.
4. A run and a lookup store the year, as tested in the DB tests.
5. `npm run check` and `npm run test:db` pass.
