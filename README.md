# Book Watcher

Watches two online bookstores, [Bokus](https://www.bokus.com) and
[Adlibris](https://www.adlibris.com/fi), for new e-books by the authors you follow.
New books show up on a local website and in one daily digest e-mail.

It runs on your own Mac. There are two parts:

- **The website** (`localhost:3192`), where you add the authors you want to follow and
  go through the books found for them.
- **The scheduler**, which runs in a terminal and searches the stores. Each author is
  searched at most once a day, and searches are spread out, so the stores see a few
  requests an hour at most.

The design is in [`specs/2026-10-29-book-watcher.md`](specs/2026-10-29-book-watcher.md)
and the build plan in [`plans/2026-10-29-book-watcher-plan.md`](plans/2026-10-29-book-watcher-plan.md).

## Setup

You need Node.js 22.22 or later and Docker.

```bash
npm install
npx playwright install chromium   # the stores are searched with headless Chromium
cp .env.example .env              # every key has a default; see "Settings" below
npm run db:up                     # Postgres 17 in Docker, on 127.0.0.1:5499
npm run db:migrate                # creates the tables
```

`db:up` also creates a second database, `book_watcher_test`, for `npm run test:db`. It is
created only when the Docker volume is new.

Check the setup:

```bash
npm run check     # lint, typecheck, unit tests, formatting
npm run test:db   # database tests, against book_watcher_test
```

## Daily use

Start the website and the scheduler in two terminals:

```bash
npm run dev         # the website on http://localhost:3192
npm run scheduler   # searches the stores; leave it running
```

The scheduler wakes once a minute. It sends the daily digest when one is due, then
starts at most one listener run if the rate limits allow. Press Ctrl+C to stop it: the
run in progress finishes first. A second Ctrl+C stops that run at once, and it is
recorded as failed.

The website has these pages:

| Page                                     | What it shows                                                    |
| ---------------------------------------- | ---------------------------------------------------------------- |
| **Suggestions** (`/`)                    | New books waiting for a decision                                 |
| **Reading list**, **Read**, **Rejected** | Books you have marked                                            |
| **Listeners** (`/listeners`)             | The authors you follow, with each one's next expected run        |
| A listener (`/listeners/<id>`)           | Its settings and every book it has found                         |
| **Runs** (`/runs`)                       | The latest searches, with failed and suspicious ones highlighted |

A book sold by both stores is shown once, with a price and link for each.

## Adding an author

1. On **Listeners**, choose **New listener**. Give the author's name as the stores write
   it, the language, an optional price range in euros, and the stores to search.
2. The listener's first run is its **seed**. It records every e-book the author has
   already published, without e-mailing you about any of them. Either wait for the
   scheduler to get to it, or run it now:

   ```bash
   npm run run-listener -- --listener <id>
   ```

   The id is in the listener's address, `/listeners/<id>`. The command follows the same
   rate limits as the scheduler; `--force` skips them for testing (but never runs two
   searches at once).

3. Open the listener's page. **Found during the seed** lists the books that were
   already out. Tick the ones you have read or don't want, and mark them in one go.
   The rest stay under Suggestions.

If a store fails during the seed, the listener stays pending and the next run seeds it
again. It never starts watching on half a seed.

After the seed, each new book the listener finds within its price range is queued for
the next digest. Later price drops into the range are queued too.

## E-mail digest

Nothing is sent until you turn it on in `.env`:

```bash
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_TO=you@example.com
# Gmail: create an app password at https://myaccount.google.com/apppasswords
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
```

`EMAIL_PROVIDER=resend` with `RESEND_API_KEY` works too.

The digest goes out at `DIGEST_TIME` (05:00 by default), or at the scheduler's first
wake-up after that if the Mac was asleep. It lists every book queued since the last
digest, at most once a day. A day with nothing queued sends nothing.

To check the e-mail settings:

```bash
npm run test-email   # sends one test e-mail, even when notifications are off or mocked
```

`npm run digest -- --force` sends the digest right away. With `EMAIL_MOCK_MODE=true` it
prints the e-mail instead of sending it. Either way it counts as that day's digest, and
the books in it won't be e-mailed again.

## Settings

All settings live in `.env`; [`.env.example`](.env.example) lists them with their
defaults. The rate limits:

| Setting                   | Default | Meaning                                                                |
| ------------------------- | ------- | ---------------------------------------------------------------------- |
| `LISTENER_INTERVAL_HOURS` | 24      | Hours between two runs of the same listener. It can't be set below 24. |
| `MIN_GAP_MINUTES`         | 30      | Minutes between the end of one run and the start of the next           |
| `GAP_JITTER_MINUTES`      | 10      | A random 0 to this many minutes added to every gap                     |
| `MAX_PAGES_PER_SEARCH`    | 10      | Result pages loaded per store in one search                            |
| `SEK_TO_EUR`              | 0.087   | Euros per Swedish krona, for Bokus prices                              |

With the defaults the scheduler gets through roughly 30 listeners a day. When there are
more than fit in `LISTENER_INTERVAL_HOURS`, the Listeners page says so. Lower
`MIN_GAP_MINUTES` or follow fewer authors.

Restart the scheduler and the website after changing `.env`.

## Troubleshooting

**A run is marked _suspicious_.** The search found nothing where earlier searches for
the same listener found books. Usually the store blocked the browser or changed its
pages. Its books are left as they were. If it keeps happening, check the store in a
normal browser and see the parser section below.

**A run _failed_ with "security checkpoint".** The store's bot protection didn't let the
headless browser through. Wait a day; the scheduler won't retry that listener before
its interval is up anyway. Don't work around the protection.

**"Stopped at the page limit"** in the scheduler's output means the author has more
books than `MAX_PAGES_PER_SEARCH` pages hold. Raise it if you want them all.

**A store changed its pages and the parser broke.** The parsers are tested against saved
pages in `tests/fixtures/<store>/`. Save a fresh one, update the parser and the tests,
and log the capture in that folder's `CAPTURES.md` (the capture script does that):

```bash
npm run capture -- --source bokus --author "Viveca Sten" --language sv
npm run search -- --source bokus --fixture tests/fixtures/bokus/<file>.html
```

Each capture is a real request to the store, so keep them few.

**The website or scheduler can't reach the database.** Check that Docker is running and
`npm run db:up` succeeded. Postgres listens on `127.0.0.1:5499`.

## Development

| Command                                                                         | What it does                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run check`                                                                 | Lint, typecheck, unit tests and formatting; run it before committing |
| `npm run test:db`                                                               | Migrates `book_watcher_test`, then runs the database tests           |
| `npm run search -- --source <store> --fixture <file>`                           | Prints what a parser makes of a saved page                           |
| `npm run search -- --source <store> --author <name> --language <sv\|fi> --live` | Searches the store itself (one real request)                         |
| `npm run build && npm start`                                                    | The production build of the website, on port 3192                    |

Schema changes are SQL migrations; see [`docs/migrations.md`](docs/migrations.md).
