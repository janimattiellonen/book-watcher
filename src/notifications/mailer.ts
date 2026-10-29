import type { EmailConfig } from '../config.js';
import { NodemailerMailer } from './nodemailerMailer.js';
import { ResendMailer } from './resendMailer.js';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  messageId: string;
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<MailResult>;
  verify?(): Promise<void>;
}

/** The provider's mailer. Throws when its credentials are missing. */
export function createMailer(config: EmailConfig): Mailer {
  if (config.provider === 'resend') {
    if (!config.resend.apiKey) {
      throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    }
    return new ResendMailer(config.resend.apiKey);
  }
  if (!config.smtp.user || !config.smtp.password) {
    throw new Error(
      'E-mail is not configured. Set SMTP_USER and SMTP_PASSWORD in .env, or EMAIL_MOCK_MODE=true',
    );
  }
  return new NodemailerMailer(config.smtp);
}

export function senderAddress(config: EmailConfig): string {
  return config.provider === 'resend' ? config.resend.from : config.smtp.user;
}

export type Email = Pick<MailMessage, 'subject' | 'text' | 'html'>;

/** Delivers one e-mail, or only logs it in mock mode. Says which; throws if sending fails. */
export type SendEmail = (email: Email) => Promise<'sent' | 'mocked'>;

export function createSendEmail(config: EmailConfig): SendEmail {
  if (config.mockMode) {
    return (email) => {
      const rule = '='.repeat(60);
      console.log(
        [
          rule,
          'E-MAIL (MOCK MODE)',
          rule,
          `To: ${config.to || '(not configured)'}`,
          `Subject: ${email.subject}`,
          '-'.repeat(60),
          email.text,
          rule,
        ].join('\n'),
      );
      return Promise.resolve('mocked');
    };
  }

  // Created on first use, so a missing credential surfaces as a failed send, which is
  // recorded and retried, rather than as a crash at startup.
  let mailer: Mailer | null = null;
  return async (email) => {
    if (!config.to) throw new Error('No recipient: set EMAIL_TO (or SMTP_USER) in .env');
    mailer ??= createMailer(config);
    await mailer.sendMail({ from: senderAddress(config), to: config.to, ...email });
    return 'sent';
  };
}
