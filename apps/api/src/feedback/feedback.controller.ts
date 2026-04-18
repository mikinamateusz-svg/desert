import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { FeedbackService } from './feedback.service.js';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';
import { SubmitContactDto } from './dto/submit-contact.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('v1')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post('feedback')
  @HttpCode(202)
  @Throttle({ default: { ttl: 3600, limit: 5 } })
  @Roles(UserRole.DRIVER, UserRole.STATION_MANAGER, UserRole.FLEET_MANAGER, UserRole.ADMIN, UserRole.DATA_BUYER)
  async submitFeedback(@Body() dto: SubmitFeedbackDto): Promise<{ message: string }> {
    await this.feedbackService.submitFeedback(dto);
    return { message: 'Feedback received' };
  }

  @Post('contact')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { ttl: 3600, limit: 3 } })
  async submitContact(@Body() dto: SubmitContactDto): Promise<{ message: string }> {
    await this.feedbackService.submitContact(dto);
    return { message: 'Message received' };
  }
}
