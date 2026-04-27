import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service.js';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  HeadBucketCommand: jest.fn().mockImplementation((input) => input),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutObjectCommand', ...input })),
  // GetObjectCommand needs a middlewareStack stub because getPresignedUrl
  // injects a build-step middleware to strip x-amz-checksum-mode (R2 fix).
  GetObjectCommand: jest.fn().mockImplementation((input) => ({
    _type: 'GetObjectCommand',
    ...input,
    middlewareStack: { add: jest.fn() },
  })),
  CopyObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'CopyObjectCommand', ...input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'DeleteObjectCommand', ...input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned.url/test'),
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

  describe('uploadBuffer', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({});
      await service.onModuleInit();
      mockSend.mockReset();
    });

    it('should call mockSend with a PutObjectCommand with correct Bucket, Key, ContentType, and Body', async () => {
      mockSend.mockResolvedValueOnce({});
      const buffer = Buffer.from('{"test": true}');
      await service.uploadBuffer('exports/user-123/12345.json', buffer, 'application/json');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0];
      expect(callArg).toMatchObject({
        _type: 'PutObjectCommand',
        Bucket: 'test-bucket',
        Key: 'exports/user-123/12345.json',
        ContentType: 'application/json',
        Body: buffer,
      });
    });
  });

  describe('getObjectBuffer', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({});
      await service.onModuleInit();
      mockSend.mockReset();
    });

    it('returns a Buffer from the R2 stream', async () => {
      async function* fakeStream() {
        yield Buffer.from('hello');
        yield Buffer.from(' world');
      }
      mockSend.mockResolvedValueOnce({ Body: fakeStream() });

      const result = await service.getObjectBuffer('test/key.jpg');

      expect(result).toEqual(Buffer.from('hello world'));
    });

    it('throws when response.Body is undefined', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined });

      await expect(service.getObjectBuffer('test/key.jpg')).rejects.toThrow(
        'R2 object body is empty for key: test/key.jpg',
      );
    });

    it('throws when accumulated bytes exceed the size limit (Story 3.9 OOM guard)', async () => {
      const limit = 5; // 5 bytes
      async function* bigStream() {
        yield Buffer.alloc(3); // 3 bytes
        yield Buffer.alloc(4); // total 7 — exceeds 5
      }
      mockSend.mockResolvedValueOnce({ Body: bigStream() });

      await expect(service.getObjectBuffer('test/big.jpg', limit)).rejects.toThrow(
        'exceeds size limit',
      );
    });

    it('accepts a stream that fits within the custom size limit', async () => {
      const limit = 10;
      async function* smallStream() {
        yield Buffer.from('hello'); // 5 bytes
      }
      mockSend.mockResolvedValueOnce({ Body: smallStream() });

      const result = await service.getObjectBuffer('test/small.jpg', limit);
      expect(result).toEqual(Buffer.from('hello'));
    });

    it('MAX_OBJECT_BYTES constant is 10 MB', () => {
      expect(StorageService.MAX_OBJECT_BYTES).toBe(10 * 1024 * 1024);
    });
  });

  describe('getPresignedUrl', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({});
      await service.onModuleInit();
      mockSend.mockReset();
    });

    it('should call getSignedUrl with the S3Client instance, a GetObjectCommand, and correct expiresIn', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner') as { getSignedUrl: jest.Mock };
      (getSignedUrl as jest.Mock).mockResolvedValueOnce('https://presigned.url/test');

      await service.getPresignedUrl('exports/user-123/12345.json', 86400);

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(), // S3Client instance
        expect.objectContaining({ _type: 'GetObjectCommand', Bucket: 'test-bucket', Key: 'exports/user-123/12345.json' }),
        { expiresIn: 86400 },
      );
    });

    it('should return the presigned URL string', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner') as { getSignedUrl: jest.Mock };
      (getSignedUrl as jest.Mock).mockResolvedValueOnce('https://presigned.url/test');

      const result = await service.getPresignedUrl('exports/user-123/12345.json', 86400);
      expect(result).toBe('https://presigned.url/test');
    });
  });
});
