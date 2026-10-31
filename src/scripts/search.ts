/**
 * Prints what a parser makes of a search results page.
 *
 *   npm run search -- --source bokus --fixture tests/fixtures/bokus/<file>.html
 *   npm run search -- --source bokus --author "Viveca Sten" --language sv --live
 *
 * Works on saved fixtures by default. `--live` searches the store itself and counts
 * against the request budget in the plan, so use it sparingly. It loads one page
 * unless --max-pages allows "load more" clicks (each one is another request).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { launchBrowser } from '../sources/browser.js';
import { searchSource, sources } from '../sources/index.js';
import { type ParsedPage, SOURCE_IDS, type SourceId } from '../sources/types.js';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    fixture: { type: 'string' },
    author: { type: 'string' },
    language: { type: 'string' },
    live: { type: 'boolean', default: false },
    'max-pages': { type: 'string', default: '1' },
  },
});

const usage =
  'Usage: search --source <adlibris|bokus> (--fixture <file> | --author <name> --language <code> --live)';

if (!values.source || !SOURCE_IDS.includes(values.source as SourceId)) {
  console.error(usage);
  process.exit(1);
}
const source = sources[values.source as SourceId];

let page: ParsedPage;
if (values.fixture) {
  page = source.parse(readFileSync(values.fixture, 'utf8'));
} else if (values.live && values.author && values.language) {
  const browser = await launchBrowser();
  try {
    const outcome = await searchSource(
      browser,
      source,
      { author: values.author, language: values.language, format: 'ebook' },
      Number(values['max-pages']),
    );
    console.log(`${outcome.requests} request(s)${outcome.truncated ? ', TRUNCATED' : ''}`);
    appendFileSync(
      new URL(`../../tests/fixtures/${source.id}/CAPTURES.md`, import.meta.url),
      `| ${new Date().toISOString().slice(0, 10)} | ${source.searchUrl({ author: values.author, language: values.language, format: 'ebook' })} | (not saved) | \`search --live\`, ${outcome.requests} request(s) |\n`,
    );
    page = outcome.page;
  } finally {
    await browser.close();
  }
} else {
  console.error(usage);
  process.exit(1);
}

console.table(
  page.results.map((result) => ({
    title: result.title.slice(0, 40),
    authors: result.authors.join(', ').slice(0, 30),
    isbn: result.isbn,
    format: result.format,
    lang: result.language,
    price: result.price === null ? null : `${result.price} ${result.currency}`,
    url: result.url,
  })),
);
console.log(
  `${page.results.length} result(s) parsed; store reports ${page.totalCount ?? '?'}; more available: ${page.hasMore}`,
);
