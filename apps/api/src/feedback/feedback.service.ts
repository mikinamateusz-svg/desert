import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';
import type { SubmitContactDto } from './dto/submit-contact.dto.js';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly config: ConfigService) {}

  async submitFeedback(dto: SubmitFeedbackDto): Promise<void> {
    // Email notification — primary delivery channel
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const feedbackTo = this.config.get<string>('FEEDBACK_EMAIL') ?? 'kontakt@litro.pl';

    if (apiKey) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from: 'Litro Feedback <noreply@litro.pl>',
          to: feedbackTo,
          subject: `[Litro Feedback] ${dto.message.slice(0, 60)}`,
          html: `<p><strong>User feedback:</strong></p>
<blockquote>${dto.message}</blockquote>
<p><small>App: ${dto.app_version} | OS: ${dto.os}</small></p>`,
        });
      } catch (err) {
        this.logger.error('Failed to send feedback email', err);
      }
    } else {
      this.logger.warn('RESEND_API_KEY not set — feedback logged only');
    }

    this.forwardToSlack(dto.message, `App: ${dto.app_version} | OS: ${dto.os}`);
  }

  async submitContact(dto: SubmitContactDto): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const contactTo = this.config.get<string>('FEEDBACK_EMAIL') ?? 'kontakt@litro.pl';

    if (apiKey) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from: 'Litro Contact <noreply@litro.pl>',
          to: contactTo,
          replyTo: dto.email,
          subject: `[Litro Contact] ${dto.subject}`,
          html: `<p><strong>From:</strong> ${dto.name} &lt;${dto.email}&gt;</p>
<p><strong>Subject:</strong> ${dto.subject}</p>
<hr>
<p>${dto.message.replace(/\n/g, '<br>')}</p>`,
        });
      } catch (err) {
        this.logger.error('Failed to send contact email', err);
      }
    } else {
      this.logger.warn('RESEND_API_KEY not set — contact form logged only');
    }

    this.forwardToSlack(`Contact from ${dto.name}: ${dto.message}`, `Reply-to: ${dto.email}`);
  }

  private forwardToSlack(message: string, meta: string): void {
    const webhookUrl = this.config.get<string>('FEEDBACK_WEBHOOK_URL');
    if (!webhookUrl) return;

    const text = `*New message*\n>${message}\n_${meta}_`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
      .then(res => { if (!res.ok) this.logger.error(`Slack webhook returned ${res.status}`); })
      .catch(err => this.logger.error('Failed to post to Slack webhook', err))
      .finally(() => clearTimeout(timeout));
  }
}
