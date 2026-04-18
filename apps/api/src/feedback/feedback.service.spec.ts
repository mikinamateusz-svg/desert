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

/** Helper: config mock that only returns webhook URL, no email key — Slack-only path */
function slackOnlyConfig(webhookUrl: string | undefined): jest.Mock {
  return jest.fn((key: string) => {
    if (key === 'FEEDBACK_WEBHOOK_URL') return webhookUrl;
    return undefined;
  });
}

/** Flush pending microtasks so fire-and-forget void fetch().then() completes */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

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

  describe('submitFeedback — Slack webhook', () => {
    it('should call fetch with correct Slack payload when FEEDBACK_WEBHOOK_URL is set', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/TEST/HOOK/URL';
      mockConfigService.get.mockImplementation(slackOnlyConfig(webhookUrl));
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await service.submitFeedback(mockDto);
      await flushPromises();

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
      mockConfigService.get.mockImplementation(slackOnlyConfig(webhookUrl));
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await service.submitFeedback(mockDto);
      await flushPromises();

      const [, calledOptions] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(calledOptions.body as string) as Record<string, unknown>;
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('user_id');
      expect(bodyStr).not.toContain('email');
      expect(bodyStr).not.toContain('display_name');
    });

    it('should NOT call fetch when neither RESEND_API_KEY nor FEEDBACK_WEBHOOK_URL is set', async () => {
      mockConfigService.get.mockImplementation(slackOnlyConfig(undefined));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service.submitFeedback(mockDto);
      await flushPromises();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY not set'));
      warnSpy.mockRestore();
    });

    it('should NOT throw when no webhook is configured', async () => {
      mockConfigService.get.mockImplementation(slackOnlyConfig(undefined));
      await expect(service.submitFeedback(mockDto)).resolves.toBeUndefined();
    });

    it('should log error (no throw) when fetch returns non-ok status', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/TEST/HOOK/URL';
      mockConfigService.get.mockImplementation(slackOnlyConfig(webhookUrl));
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.submitFeedback(mockDto)).resolves.toBeUndefined();
      await flushPromises();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('500'));
      errorSpy.mockRestore();
    });

    it('should log error (no throw) when fetch throws a network error', async () => {
      const webhookUrl = 'https://hooks.slack.com/services/TEST/HOOK/URL';
      mockConfigService.get.mockImplementation(slackOnlyConfig(webhookUrl));
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.submitFeedback(mockDto)).resolves.toBeUndefined();
      await flushPromises();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
