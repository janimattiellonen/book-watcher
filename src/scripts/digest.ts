/**
 * Sends today's digest of queued books.
 *
 *   npm run digest -- [--force]
 *
 * Without --force it follows the once-a-day rule, like the scheduler. --force sends
 * right away, for testing. Either way nothing happens unless
 * EMAIL_NOTIFICATIONS_ENABLED=true; with EMAIL_MOCK_MODE=true the e-mail is only logged.
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createSendEmail } from '../notifications/mailer.js';
import { runDailyDigest } from '../notifications/sendDailyDigest.js';

const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } });

const config = loadConfig();
const db = createPool();

try {
  const outcome = await runDailyDigest({
    db,
    send: createSendEmail(config.email),
    now: new Date(),
    enabled: config.emailNotificationsEnabled,
    digestTime: config.digestTime,
    force: values.force,
  });

  switch (outcome.status) {
    case 'disabled':
      console.log(
        'E-mail notifications are off (EMAIL_NOTIFICATIONS_ENABLED=false). Nothing sent.',
      );
      break;
    case 'not-due':
      console.log(
        `No digest is due: it is before ${config.digestTime}, today's digest is done, or a failed one is waiting to retry. Use --force to send anyway.`,
      );
      break;
    case 'empty':
      console.log('No books are queued. Nothing sent.');
      break;
    case 'failed':
      console.error(`Sending failed: ${outcome.error}. The books stay queued.`);
      process.exitCode = 1;
      break;
    default:
      console.log(`Digest ${outcome.status} with ${outcome.bookIds.length} book(s).`);
  }
  if ('recorded' in outcome && !outcome.recorded) {
    console.log('Today already had a completed digest, so this one is not recorded as another.');
  }
} finally {
  await db.end();
}
