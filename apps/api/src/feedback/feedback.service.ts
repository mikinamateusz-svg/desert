import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly config: ConfigService) {}

  async submitFeedback(dto: SubmitFeedbackDto): Promise<void> {
    const webhookUrl = this.config.get<string>('FEEDBACK_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn('FEEDBACK_WEBHOOK_URL not set — feedback received but not forwarded');
      return;
    }

    const text = `*New feedback*\n>${dto.message}\n_App: ${dto.app_version} | OS: ${dto.os}_`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.error(`Slack webhook returned ${res.status}`);
      }
    } catch (err) {
      this.logger.error('Failed to post feedback to webhook', err);
    } finally {
      clearTimeout(timeout);
    }
  }
}
