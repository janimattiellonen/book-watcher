/**
 * Prints what the series lookup makes of an Adlibris book page.
 *
 *   npm run series-lookup -- --fixture tests/fixtures/adlibris/book-hildur.html
 *   npm run series-lookup -- --url https://www.adlibris.com/fi/kirja/<slug>-<isbn> --live
 *
 * Works on saved pages by default. `--live` loads the page from the store, which is one
 * real request; it is logged in the Adlibris CAPTURES.md, so use it sparingly.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  type AdlibrisBook,
  fetchAdlibrisBook,
  parseAdlibrisBook,
} from '../sources/adlibrisBook.js';
import { launchBrowser } from '../sources/browser.js';
import { describeSeries } from '../sources/series.js';

const { values } = parseArgs({
  options: {
    fixture: { type: 'string' },
    url: { type: 'string' },
    live: { type: 'boolean', default: false },
  },
});

let book: AdlibrisBook;
if (values.fixture) {
  book = parseAdlibrisBook(readFileSync(values.fixture, 'utf8'));
} else if (values.live && values.url) {
  const browser = await launchBrowser();
  try {
    book = await fetchAdlibrisBook(browser, values.url);
  } finally {
    await browser.close();
    appendFileSync(
      new URL('../../tests/fixtures/adlibris/CAPTURES.md', import.meta.url),
      `| ${new Date().toISOString().slice(0, 10)} | ${values.url} | (not saved) | \`series-lookup --live\` |\n`,
    );
  }
} else {
  console.error('Usage: series-lookup (--fixture <file> | --url <adlibris book url> --live)');
  process.exit(1);
}

console.log(`ISBN:   ${book.isbn ?? '(none)'}`);
console.log(`Series: ${book.series ? describeSeries(book.series) : '(none)'}`);
