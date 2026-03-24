import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';

const mockFeedbackService = {
  submitFeedback: jest.fn(),
};

describe('FeedbackController', () => {
  let controller: FeedbackController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [
        { provide: FeedbackService, useValue: mockFeedbackService },
      ],
    }).compile();

    controller = module.get<FeedbackController>(FeedbackController);
  });

  describe('submitFeedback', () => {
    it('should call feedbackService.submitFeedback with the dto and return 202 { message: "Feedback received" }', async () => {
      const dto: SubmitFeedbackDto = {
        message: 'Great app!',
        app_version: '1.0.0',
        os: 'ios',
      };
      mockFeedbackService.submitFeedback.mockResolvedValueOnce(undefined);

      const result = await controller.submitFeedback(dto);

      expect(mockFeedbackService.submitFeedback).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Feedback received' });
    });

    it('should propagate errors thrown by feedbackService.submitFeedback', async () => {
      const dto: SubmitFeedbackDto = {
        message: 'Test',
        app_version: '1.0.0',
        os: 'android',
      };
      mockFeedbackService.submitFeedback.mockRejectedValueOnce(new Error('Unexpected error'));

      await expect(controller.submitFeedback(dto)).rejects.toThrow('Unexpected error');
    });
  });

  describe('ValidationPipe integration', () => {
    let pipe: ValidationPipe;

    beforeEach(() => {
      pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    });

    it('should reject a message longer than 1000 characters', async () => {
      const dto = {
        message: 'a'.repeat(1001),
        app_version: '1.0.0',
        os: 'ios',
      };

      await expect(pipe.transform(dto, { type: 'body', metatype: SubmitFeedbackDto })).rejects.toThrow();
    });

    it('should reject an empty message', async () => {
      const dto = {
        message: '',
        app_version: '1.0.0',
        os: 'ios',
      };

      await expect(pipe.transform(dto, { type: 'body', metatype: SubmitFeedbackDto })).rejects.toThrow();
    });

    it('should accept a valid dto', async () => {
      const dto = {
        message: 'Valid feedback',
        app_version: '1.0.0',
        os: 'ios',
      };

      const result = await pipe.transform(dto, { type: 'body', metatype: SubmitFeedbackDto });
      expect(result).toEqual(dto);
    });
  });
});
