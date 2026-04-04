import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { FeedbackService } from './feedback.service.js';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@Controller('v1/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(202)
  @Throttle({ default: { ttl: 3600, limit: 5 } })
  @Roles(UserRole.DRIVER, UserRole.STATION_MANAGER, UserRole.FLEET_MANAGER, UserRole.ADMIN, UserRole.DATA_BUYER)
  async submitFeedback(@Body() dto: SubmitFeedbackDto): Promise<{ message: string }> {
    await this.feedbackService.submitFeedback(dto);
    return { message: 'Feedback received' };
  }
}
