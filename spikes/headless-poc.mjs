import { chromium } from 'playwright';
const targets = {
  bokus: 'https://www.bokus.com/search?q=viveca+sten&facets=format%3AEBOOK%2ClanguageCodes%3Aswe',
  adlibris:
    'https://www.adlibris.com/fi/haku?refinementList%5Blanguage%5D%5B0%5D=suomi&refinementList%5Bformat%5D%5B0%5D=E-kirja&q=heikki%20hietala',
};
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: 'fi-FI',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
});
for (const [name, url] of Object.entries(targets)) {
  const page = await ctx.newPage();
  const statuses = [];
  page.on('response', (r) => {
    if (r.request().resourceType() === 'document') statuses.push(r.status());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20; i++) {
    const t = await page.title();
    if (!/Security Checkpoint/i.test(t)) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const title = await page.title();
  const html = await page.content();
  const text = await page.evaluate(() => document.body.innerText);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${name}.html`, html);
  writeFileSync(`${name}.txt`, text);
  await page.screenshot({ path: `${name}.png`, fullPage: false });
  console.log(
    `== ${name}: doc statuses=${statuses.join(',')} title="${title}" html=${html.length} bytes`,
  );
}
await browser.close();
