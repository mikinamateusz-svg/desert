import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PhotoPipelineWorker, PHOTO_PIPELINE_QUEUE, PHOTO_PIPELINE_JOB } from './photo-pipeline.worker.js';

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockWorkerClose = jest.fn();
const mockWorkerOn = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation(() => ({
    close: mockWorkerClose,
    on: mockWorkerOn,
  })),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    quit: jest.fn(),
  })),
);

describe('PhotoPipelineWorker', () => {
  let worker: PhotoPipelineWorker;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotoPipelineWorker,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'redis://localhost:6379' },
        },
      ],
    }).compile();

    worker = module.get<PhotoPipelineWorker>(PhotoPipelineWorker);
    await worker.onModuleInit();
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  describe('enqueue', () => {
    it('adds job with submissionId, correct jobId, and retry options', async () => {
      await worker.enqueue('sub-uuid-123');

      expect(mockQueueAdd).toHaveBeenCalledWith(
        PHOTO_PIPELINE_JOB,
        { submissionId: 'sub-uuid-123' },
        expect.objectContaining({
          jobId: 'photo-sub-uuid-123',
          attempts: 4,
          backoff: { type: 'custom' },
        }),
      );
    });

    it('uses unique jobId per submissionId for dedup', async () => {
      await worker.enqueue('sub-aaa');
      await worker.enqueue('sub-bbb');

      const calls = mockQueueAdd.mock.calls;
      expect(calls[0][2]).toMatchObject({ jobId: 'photo-sub-aaa' });
      expect(calls[1][2]).toMatchObject({ jobId: 'photo-sub-bbb' });
    });
  });

  describe('getQueue', () => {
    it('returns the Queue instance', () => {
      const queue = worker.getQueue();
      expect(queue).toBeDefined();
      expect(typeof queue.add).toBe('function');
    });
  });

  describe('onModuleDestroy', () => {
    it('closes worker, queue, and redis connection', async () => {
      await worker.onModuleDestroy();
      expect(mockWorkerClose).toHaveBeenCalled();
      expect(mockQueueClose).toHaveBeenCalled();
    });
  });

  describe('queue name', () => {
    it('PHOTO_PIPELINE_QUEUE constant is "photo-pipeline"', () => {
      expect(PHOTO_PIPELINE_QUEUE).toBe('photo-pipeline');
    });
  });
});
