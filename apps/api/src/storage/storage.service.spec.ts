import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service.js';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  HeadBucketCommand: jest.fn().mockImplementation((input) => input),
}));

describe('StorageService', () => {
  let service: StorageService;

  const mockConfig: Record<string, string> = {
    R2_ACCOUNT_ID: 'test-account-id',
    R2_BUCKET_NAME: 'test-bucket',
    R2_ACCESS_KEY_ID: 'test-key-id',
    R2_SECRET_ACCESS_KEY: 'test-secret',
  };

  beforeEach(async () => {
    mockSend.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (mockConfig[key]) return mockConfig[key];
              throw new Error(`Missing config: ${key}`);
            },
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize S3Client and call testConnection', async () => {
      mockSend.mockResolvedValueOnce({});
      await service.onModuleInit();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('testConnection', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({});
      await service.onModuleInit();
      mockSend.mockReset();
    });

    it('should log success when bucket is reachable', async () => {
      mockSend.mockResolvedValueOnce({});
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      await service.testConnection();
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('R2 bucket connection OK');
    });

    it('should log error when bucket is not reachable', async () => {
      const error = new Error('Connection refused');
      mockSend.mockRejectedValueOnce(error);
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
      await service.testConnection();
      expect(errorSpy).toHaveBeenCalledWith('R2 bucket connection FAILED', error);
    });
  });
});
