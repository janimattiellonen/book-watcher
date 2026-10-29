import { type Browser, chromium, type Page } from 'playwright';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** How long to wait for the stores' security checkpoint to let the browser through. */
const CHECKPOINT_TIMEOUT_MS = 30_000;

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export async function newPage(browser: Browser, locale: string): Promise<Page> {
  const context = await browser.newContext({ userAgent: USER_AGENT, locale });
  return context.newPage();
}

/**
 * Loads a URL and waits until the security checkpoint has handed over to the real
 * page. If the checkpoint never clears, the page is left on it, and the parser's
 * `assertNotBlocked` reports it as a `BlockedError`.
 */
export async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page
    .waitForFunction(() => !/Security Checkpoint/i.test(document.title), undefined, {
      timeout: CHECKPOINT_TIMEOUT_MS,
      polling: 1000,
    })
    .catch(() => undefined);
  await settle(page);
}

/** Waits for client-side requests to quiet down, without failing if they never do. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
}

/**
 * Waits a random 5–10 seconds. Called before every page load or "load more" click
 * after the first, so the stores never see requests in quick succession.
 */
export function politeDelay(minMs = 5_000, maxMs = 10_000): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
