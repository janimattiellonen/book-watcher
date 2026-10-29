import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailConfig } from '../config.js';
import type { Mailer, MailMessage, MailResult } from './mailer.js';

/** SMTP, e.g. Gmail with an app password. */
export class NodemailerMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(config: EmailConfig['smtp']) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
    });
  }

  async sendMail(message: MailMessage): Promise<MailResult> {
    const info = await this.transporter.sendMail(message);
    return { messageId: info.messageId };
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}
