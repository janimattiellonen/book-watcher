# Adlibris live captures

| Date       | URL                                                                                                                                      | File                                          | Purpose                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2026-10-29 | https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=heikki%20hietala  | `checkpoint-curl-429.html`                    | curl probe; Vercel Security Checkpoint page (HTTP 429)                                |
| 2026-10-29 | same as above                                                                                                                            | `search-heikki-hietala-fi-ebook.html`         | PoC with headless Chromium; 4 results                                                 |
| 2026-10-29 | https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=Arto+Paasilinna   | `search-arto-paasilinna-fi-ebook.html`        | large result list, first page                                                         |
| 2026-10-29 | https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=Arto+Paasilinna   | `search-arto-paasilinna-fi-ebook.html`        | repeat load of the row above, same file overwritten (reason not recorded at the time) |
| 2026-10-29 | (load more #1 on the page above)                                                                                                         | `search-arto-paasilinna-fi-ebook-more-1.html` | pagination                                                                            |
| 2026-10-29 | https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=Qzxwv+Nonexistent | `search-empty.html`                           | no results                                                                            |
| 2026-10-29 | https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=Heikki+Hietala    | (not saved)                                   | `search --live`, 4 request(s)                                                         |
| 2026-10-29 | https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=heikki%20hietala  | `search-heikki-hietala-poc-url.html`          | PoC URL (%20) to compare hit counts                                                   |
| 2026-10-29 | https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=Heikki+Hietala    | `search-heikki-hietala-builder-url.html`      | URL builder (+) to compare hit counts                                                 |

## Budget

The plan allows at most 5 live page loads per store for T4/T5. The curl probe and the PoC
capture predate T4 and are not counted. Counted loads, by row:

| Rows                                                                                                                                   | Loads  |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| arto-paasilinna (first load and the repeat load)                                                                                       | 2      |
| load more #1                                                                                                                           | 1      |
| search-empty                                                                                                                           | 1      |
| `search --live` (ran with the old default of up to 4 pages; the default is now 1)                                                      | 4      |
| poc-url and builder-url (URL-encoding comparison, taken to diagnose the 73-hit result that was the filter-timing bug fixed in 0f936e4) | 2      |
| **Total**                                                                                                                              | **10** |

This is 5 over the plan's cap of 5. The overage was signed off by the project owner on
2026-10-29 during the PR #2 review. The T4/T5 budget is spent; further live Adlibris loads
need a new budget.
