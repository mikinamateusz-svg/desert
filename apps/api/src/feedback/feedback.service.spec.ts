import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedbackService } from './feedback.service.js';
import type { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';

// Mock global fetch
global.fetch = jest.fn();

const mockConfigService = {
  get: jest.fn(),
};

const mockDto: SubmitFeedbackDto = {
  message: 'Great app!',
  app_version: '1.0.0',
  os: 'ios',
};

describe('FeedbackService', () => {
  let service: FeedbackService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  describe('submitFeedback', () => {
    it('should call fetch with correct Slack payload when FEEDBACK_WEBHOOK_URL is set', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/TEST/HOOK/URL';
      mockConfigService.get.mockReturnValue(webhookUrl);
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await service.submitFeedback(mockDto);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(webhookUrl);
      expect(calledOptions.method).toBe('POST');
      expect((calledOptions.headers as Record<string, string>)['Content-Type']).toBe('application/json');

      const body = JSON.parse(calledOptions.body as string) as { text: string };
      expect(body.text).toContain('Great app!');
      expect(body.text).toContain('1.0.0');
      expect(body.text).toContain('ios');
    });

    it('should NOT include any user identity fields in the webhook payload', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/TEST/HOOK/URL';
      mockConfigService.get.mockReturnValue(webhookUrl);
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await service.submitFeedback(mockDto);

      const [, calledOptions] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(calledOptions.body as string) as Record<string, unknown>;
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('user_id');
      expect(bodyStr).not.toContain('email');
      expect(bodyStr).not.toContain('display_name');
    });

    it('should log warn and return without calling fetch when FEEDBACK_WEBHOOK_URL is not set', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service.submitFeedback(mockDto);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('FEEDBACK_WEBHOOK_URL not set'));
      warnSpy.mockRestore();
    });

    it('should NOT throw when FEEDBACK_WEBHOOK_URL is not set', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      await expect(service.submitFeedback(mockDto)).resolves.toBeUndefined();
    });

    it('should log error (no throw) when fetch returns non-ok status', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/TEST/HOOK/URL';
      mockConfigService.get.mockReturnValue(webhookUrl);
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.submitFeedback(mockDto)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('500'));
      errorSpy.mockRestore();
    });

    it('should log error (no throw) when fetch throws a network error', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/TEST/HOOK/URL';
      mockConfigService.get.mockReturnValue(webhookUrl);
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.submitFeedback(mockDto)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
