# Book Watcher: notes for agents

Setup and usage are in README.md; the design is in `specs/`, the build plan in `plans/`.

## Checks

- Run `npm run check` before every commit, and `npm run test:db` when code touching
  the database changed.

## Database

- Postgres runs in Docker on `127.0.0.1:5499`. Development data is in `book_watcher`
  and belongs to the user; DB tests use `book_watcher_test`. Clean up any rows you add
  to the development database.
- Never run `npm run db:reset` or `npm run db:down`.
- psql: `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d book_watcher'`.
- Schema changes are SQL migrations (`docs/migrations.md`). Verify the down/up round
  trip, and ask before changing the schema beyond the spec. Parameterized SQL only.

## The stores

- Work against the saved pages in `tests/fixtures/`. Any live request (`capture`,
  `search --live`, `run-listener`, `scheduler`) is a real hit on Bokus or Adlibris:
  ask first, and log captures in that folder's `CAPTURES.md`.
- Never work around the stores' bot protection (no CAPTCHA solvers, proxies or
  rotating identities).

## Never

- Commit `.env` or credentials, or send real e-mail from tests.
- Mark a listener active after a partial seed, or delete books when a listener is
  deleted.
