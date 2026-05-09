import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceRiseSignalPublisher } from './price-rise-signal.publisher.js';
import {
  PRICE_RISE_SIGNAL_JOB,
  PRICE_RISE_SIGNALS_QUEUE,
  type MovementRecord,
} from './types.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn().mockResolvedValue(undefined);

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    quit: jest.fn().mockResolvedValue(undefined),
  })),
);

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const at = new Date('2026-05-09T12:00:00Z');
const move = (signalType: string, pctChange: number | null): MovementRecord => ({
  signalType,
  pctChange,
  significantMovement: pctChange !== null && Math.abs(pctChange) >= 0.03,
  recordedAt: at,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PriceRiseSignalPublisher', () => {
  let publisher: PriceRiseSignalPublisher;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceRiseSignalPublisher,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    publisher = module.get(PriceRiseSignalPublisher);
    await publisher.onModuleInit();
  });

  afterEach(async () => {
    await publisher.onModuleDestroy();
  });

  // ── Threshold ─────────────────────────────────────────────────────────────

  it('publishes a job when an upward movement ≥3% is provided', async () => {
    const published = await publisher.maybePublish([move('orlen_rack_pb95', 0.035)]);

    expect(published).toBe(1);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      PRICE_RISE_SIGNAL_JOB,
      expect.objectContaining({
        signalSource: 'orlen_rack',
        signalType: 'orlen_rack_pb95',
        fuelTypes: ['PB_95', 'PB_98'],
        pctMovement: 0.035,
        recordedAt: at.toISOString(),
      }),
    );
  });

  it('does NOT publish when movement is downward (negative pctChange)', async () => {
    const published = await publisher.maybePublish([move('orlen_rack_pb95', -0.05)]);

    expect(published).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('does NOT publish when upward movement is below the 3% threshold', async () => {
    const published = await publisher.maybePublish([move('orlen_rack_pb95', 0.02)]);

    expect(published).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('does NOT publish when pctChange is null (no previous signal)', async () => {
    const published = await publisher.maybePublish([move('orlen_rack_pb95', null)]);

    expect(published).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  // ── Fuel-type mapping per signal ──────────────────────────────────────────

  it('maps orlen_rack_on → ON + ON_PREMIUM', async () => {
    await publisher.maybePublish([move('orlen_rack_on', 0.04)]);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      PRICE_RISE_SIGNAL_JOB,
      expect.objectContaining({ fuelTypes: ['ON', 'ON_PREMIUM'] }),
    );
  });

  it('maps orlen_rack_lpg → LPG only', async () => {
    await publisher.maybePublish([move('orlen_rack_lpg', 0.05)]);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      PRICE_RISE_SIGNAL_JOB,
      expect.objectContaining({ fuelTypes: ['LPG'] }),
    );
  });

  it('maps brent_crude_pln → all crude-derived fuels (no LPG)', async () => {
    await publisher.maybePublish([move('brent_crude_pln', 0.06)]);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      PRICE_RISE_SIGNAL_JOB,
      expect.objectContaining({
        signalSource: 'brent_crude_pln',
        fuelTypes: ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM'],
      }),
    );
  });

  // ── Multi-signal batches ───────────────────────────────────────────────────

  it('publishes one job per qualifying signal in a batch', async () => {
    const published = await publisher.maybePublish([
      move('orlen_rack_pb95', 0.04),
      move('orlen_rack_on', 0.05),
      move('orlen_rack_lpg', 0.01), // below threshold
      move('brent_crude_pln', 0.06),
    ]);

    expect(published).toBe(3);
    expect(mockQueueAdd).toHaveBeenCalledTimes(3);
  });

  it('continues publishing remaining signals when one queue.add() throws', async () => {
    mockQueueAdd
      .mockRejectedValueOnce(new Error('Redis hiccup'))
      .mockResolvedValueOnce({ id: 'job-2' });

    const published = await publisher.maybePublish([
      move('orlen_rack_pb95', 0.04),
      move('orlen_rack_on', 0.05),
    ]);

    expect(published).toBe(1);
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
  });

  // ── Unknown signal types ──────────────────────────────────────────────────

  it('skips signals with no fuel-type mapping (defensive against future enum additions)', async () => {
    const published = await publisher.maybePublish([move('mystery_signal', 0.1)]);

    expect(published).toBe(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  // ── Queue identity ────────────────────────────────────────────────────────

  it('exposes the queue via getQueue() for ops/integration tests', () => {
    const queue = publisher.getQueue();
    expect(queue).toBeDefined();
  });

  it('uses the correct queue name constant', async () => {
    // The Queue mock's constructor is called with the queue name in onModuleInit
    const { Queue } = await import('bullmq');
    expect(Queue).toHaveBeenCalledWith(
      PRICE_RISE_SIGNALS_QUEUE,
      expect.objectContaining({ defaultJobOptions: expect.any(Object) }),
    );
  });
});
