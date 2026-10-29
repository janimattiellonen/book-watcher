# Bokus live captures

| Date       | URL                                                                                          | File                                          | Purpose                                                |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| 2026-10-29 | https://www.bokus.com/search?q=viveca+sten&facets=format%3AEBOOK%2ClanguageCodes%3Aswe       | `checkpoint-curl-429.html`                    | curl probe; Vercel Security Checkpoint page (HTTP 429) |
| 2026-10-29 | same as above                                                                                | `search-viveca-sten-sv-ebook.html`            | PoC with headless Chromium; 27 results                 |
| 2026-10-29 | https://www.bokus.com/search?q=Astrid+Lindgren&facets=format%3AEBOOK%2ClanguageCodes%3Aswe   | `search-astrid-lindgren-sv-ebook.html`        | large result list, first page                          |
| 2026-10-29 | https://www.bokus.com/search?q=Astrid+Lindgren&facets=format%3AEBOOK%2ClanguageCodes%3Aswe   | `search-astrid-lindgren-sv-ebook.html`        | large result list (retry after consent-banner fix)     |
| 2026-10-29 | (load more #1 on the page above)                                                             | `search-astrid-lindgren-sv-ebook-more-1.html` | pagination                                             |
| 2026-10-29 | https://www.bokus.com/search?q=Qzxwv+Nonexistent&facets=format%3AEBOOK%2ClanguageCodes%3Aswe | `search-empty.html`                           | no results                                             |
| 2026-10-29 | https://www.bokus.com/search?q=Viveca+Sten&facets=format%3AEBOOK%2ClanguageCodes%3Aswe       | (not saved)                                   | `search --live`, 1 request(s)                          |
