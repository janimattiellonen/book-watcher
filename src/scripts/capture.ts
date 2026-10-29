/**
 * Saves a live search results page as a test fixture. During development this is the
 * only script that contacts a store; parser work then iterates on the saved HTML.
 *
 *   npm run capture -- --source bokus --author "Viveca Sten" --language sv
 *     [--name slug] [--load-more N] [--purpose "why"] [--overwrite]
 *
 * Writes tests/fixtures/<source>/<slug>.html (+ .png), and <slug>-more-<k>.html after
 * each "load more", then logs every request it made in CAPTURES.md.
 */
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { launchBrowser, newPage, openPage, politeDelay } from '../sources/browser.js';
import { sources } from '../sources/index.js';
import { SOURCE_IDS, type SourceId } from '../sources/types.js';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    author: { type: 'string' },
    language: { type: 'string' },
    name: { type: 'string' },
    'load-more': { type: 'string', default: '0' },
    purpose: { type: 'string', default: '' },
    overwrite: { type: 'boolean', default: false },
  },
});

if (!values.source || !SOURCE_IDS.includes(values.source as SourceId) || !values.author) {
  console.error(
    'Usage: capture --source <adlibris|bokus> --author <name> --language <code> [--name slug] [--load-more N] [--purpose text] [--overwrite]',
  );
  process.exit(1);
}

const source = sources[values.source as SourceId];
const query = {
  author: values.author,
  language: values.language ?? 'fi',
  format: 'ebook' as const,
};
const slug =
  values.name ??
  `search-${values.author.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${query.language}-ebook`;
const dir = new URL(`../../tests/fixtures/${source.id}/`, import.meta.url);
const htmlFile = new URL(`${slug}.html`, dir);

if (existsSync(htmlFile) && !values.overwrite) {
  console.error(`${htmlFile.pathname} exists already. Pass --overwrite to replace it.`);
  process.exit(1);
}

const url = source.searchUrl(query);
const loadMore = Number(values['load-more']);
const today = new Date().toISOString().slice(0, 10);
const log: string[] = [];

const browser = await launchBrowser();
try {
  const page = await newPage(browser, source.locale);
  await openPage(page, url);
  const html = await page.content();
  writeFileSync(htmlFile, html);
  await page.screenshot({ path: new URL(`${slug}.png`, dir).pathname });
  log.push(`| ${today} | ${url} | \`${slug}.html\` | ${values.purpose || 'search results'} |`);
  console.log(`Saved ${slug}.html (${html.length} bytes)`);

  for (let k = 1; k <= loadMore; k++) {
    if (!source.parse(await page.content()).hasMore) {
      console.log('No more results to load.');
      break;
    }
    await politeDelay();
    await source.loadMore(page);
    const moreFile = `${slug}-more-${k}.html`;
    writeFileSync(new URL(moreFile, dir), await page.content());
    log.push(`| ${today} | (load more #${k} on the page above) | \`${moreFile}\` | pagination |`);
    console.log(`Saved ${moreFile}`);
  }
} finally {
  await browser.close();
  if (log.length > 0) {
    appendFileSync(new URL('CAPTURES.md', dir), `${log.join('\n')}\n`);
    console.log(`Logged ${log.length} request(s) in tests/fixtures/${source.id}/CAPTURES.md`);
  }
}
