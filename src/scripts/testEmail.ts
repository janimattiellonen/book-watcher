/**
 * Sends a test e-mail with the configured provider, to check the e-mail settings.
 *
 *   npm run test-email -- [recipient]
 *
 * Sends for real even when EMAIL_NOTIFICATIONS_ENABLED or EMAIL_MOCK_MODE say
 * otherwise, since checking the real delivery is the point.
 */
import { loadConfig } from '../config.js';
import { createMailer, senderAddress } from '../notifications/mailer.js';

const { email } = loadConfig();
const to = process.argv[2] || email.to;
const from = senderAddress(email);

console.log(`Provider: ${email.provider}`);
if (email.provider === 'nodemailer') console.log(`SMTP: ${email.smtp.host}:${email.smtp.port}`);
console.log(`From: ${from || '(not configured)'}`);
console.log(`To: ${to || '(not configured)'}`);

if (!to) {
  console.error('No recipient: set EMAIL_TO (or SMTP_USER) in .env, or pass one as an argument.');
  process.exit(1);
}

try {
  const mailer = createMailer(email);
  if (mailer.verify) {
    await mailer.verify();
    console.log('Connection verified.');
  }
  const { messageId } = await mailer.sendMail({
    from,
    to,
    subject: 'Book Watcher: test e-mail',
    text: 'This is a test e-mail from Book Watcher. If you got it, the digest can reach you too.',
  });
  console.log(`Sent, message id ${messageId}.`);
} catch (error) {
  console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
