import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from './redis.module.js';

const mockOn = jest.fn();
const mockQuit = jest.fn().mockResolvedValue('OK');

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: mockOn,
    quit: mockQuit,
  }));
});

const mockConfigService = {
  getOrThrow: () => 'redis://localhost:6379',
};

describe('RedisModule REDIS_CLIENT factory', () => {
  let module: TestingModule;

  beforeEach(async () => {
    mockOn.mockReset();

    const Redis = (await import('ioredis')).default;

    module = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: REDIS_CLIENT,
          useFactory: (config: ConfigService) => {
            const client = new Redis(config.getOrThrow('REDIS_URL'), {
              maxRetriesPerRequest: 3,
              lazyConnect: false,
            });
            client.on('connect', () => console.log('Redis connected'));
            client.on('error', (err: unknown) => console.error('Redis error', err));
            return client;
          },
          inject: [ConfigService],
        },
      ],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should provide REDIS_CLIENT', () => {
    const client = module.get(REDIS_CLIENT);
    expect(client).toBeDefined();
  });

  it('should register connect and error event listeners', () => {
    module.get(REDIS_CLIENT);
    expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
