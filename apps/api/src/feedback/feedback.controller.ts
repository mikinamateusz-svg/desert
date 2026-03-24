import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FeedbackService } from './feedback.service.js';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';

@Controller('v1/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(202)
  @Throttle({ default: { ttl: 3600, limit: 5 } })
  async submitFeedback(@Body() dto: SubmitFeedbackDto): Promise<{ message: string }> {
    await this.feedbackService.submitFeedback(dto);
    return { message: 'Feedback received' };
  }
}
