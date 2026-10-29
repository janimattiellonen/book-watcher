import { Resend } from 'resend';

import type { Mailer, MailMessage, MailResult } from './mailer.js';

export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async sendMail(message: MailMessage): Promise<MailResult> {
    const { data, error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error) throw new Error(error.message);
    return { messageId: data.id };
  }
}
