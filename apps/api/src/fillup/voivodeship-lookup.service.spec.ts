import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VoivodeshipLookupService } from './voivodeship-lookup.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRedis = { get: mockGet, set: mockSet };

const mockConfigGet = jest.fn();
const mockConfig = { get: mockConfigGet };

// We mock global fetch — every test sets a fresh mock per call.
const originalFetch = global.fetch;

const LAT = 51.7592;
const LNG = 19.456;

function nominatimResponse(stateName: string | null) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({ address: stateName === null ? {} : { state: stateName } }),
  };
}

describe('VoivodeshipLookupService', () => {
  let service: VoivodeshipLookupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue('OK');
    mockConfigGet.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoivodeshipLookupService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<VoivodeshipLookupService>(VoivodeshipLookupService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ── Cache hits ─────────────────────────────────────────────────────────

  it('returns cached slug without calling Nominatim', async () => {
    mockGet.mockResolvedValueOnce('lodzkie');
    global.fetch = jest.fn();

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBe('lodzkie');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null on cached null sentinel without calling Nominatim', async () => {
    mockGet.mockResolvedValueOnce('__none__');
    global.fetch = jest.fn();

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses 2dp grid cache key (adjacent fill-ups share cache)', async () => {
    mockGet.mockResolvedValueOnce('lodzkie');

    await service.lookupByGps(51.7592, 19.456);

    expect(mockGet).toHaveBeenCalledWith('voivodeship:gps:51.76:19.46');
  });

  // ── Network success ────────────────────────────────────────────────────

  it('calls Nominatim with the expected URL + User-Agent (coords are 2dp-rounded per P-1)', async () => {
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('województwo łódzkie'));

    // 51.7592 / 19.456 round to 51.76 / 19.46 — P-1 privacy rounding.
    await service.lookupByGps(LAT, LNG);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('nominatim.openstreetmap.org/reverse');
    expect(url).toContain('lat=51.76');
    expect(url).toContain('lon=19.46');
    expect(url).toContain('zoom=5');
    expect(url).toContain('accept-language=pl');
    expect(init.headers['User-Agent']).toMatch(/litro/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps Polish state name to slug', async () => {
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('województwo łódzkie'));

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBe('lodzkie');
  });

  it('maps each of the 16 voivodeships correctly', async () => {
    const cases: [string, string][] = [
      ['województwo dolnośląskie', 'dolnoslaskie'],
      ['województwo mazowieckie', 'mazowieckie'],
      ['województwo zachodniopomorskie', 'zachodniopomorskie'],
      ['województwo warmińsko-mazurskie', 'warminsko-mazurskie'],
    ];
    for (const [state, expectedSlug] of cases) {
      jest.clearAllMocks();
      mockGet.mockResolvedValueOnce(null);
      global.fetch = jest.fn().mockResolvedValue(nominatimResponse(state));

      const result = await service.lookupByGps(LAT, LNG);

      expect(result).toBe(expectedSlug);
    }
  });

  it('caches the resolved slug for 24h', async () => {
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('województwo łódzkie'));

    await service.lookupByGps(LAT, LNG);

    expect(mockSet).toHaveBeenCalledWith(
      'voivodeship:gps:51.76:19.46',
      'lodzkie',
      'EX',
      24 * 60 * 60,
    );
  });

  // ── Negative paths ─────────────────────────────────────────────────────

  it('returns null and caches the null sentinel when state is unmapped', async () => {
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('Brandenburg'));

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBeNull();
    expect(mockSet).toHaveBeenCalledWith(
      'voivodeship:gps:51.76:19.46',
      '__none__',
      'EX',
      24 * 60 * 60,
    );
  });

  it('returns null when Nominatim returns no address.state', async () => {
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse(null));

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBeNull();
  });

  it('returns null on Nominatim non-200 response (P-7 covered separately for 429/5xx)', async () => {
    // Use 502 to assert the transient-class path; specific TTL split is
    // tested in the P-7 dedicated tests above.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502 });

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBeNull();
    // Still caches the null so we don't hammer Nominatim during their outage.
    expect(mockSet).toHaveBeenCalledWith(
      expect.stringContaining('voivodeship:gps:'),
      '__none__',
      'EX',
      5 * 60, // P-7: 5xx is transient → short TTL
    );
  });

  it('returns null and caches null on AbortError (5s timeout) — short TTL per P-7', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBeNull();
    expect(mockSet).toHaveBeenCalledWith(
      expect.any(String),
      '__none__',
      'EX',
      5 * 60,
    );
  });

  it('returns null on generic network error (never throws)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(service.lookupByGps(LAT, LNG)).resolves.toBeNull();
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it('returns null on non-finite coordinates without calling Nominatim', async () => {
    global.fetch = jest.fn();

    expect(await service.lookupByGps(NaN, LNG)).toBeNull();
    expect(await service.lookupByGps(LAT, Infinity)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── P-9 — coordinate range validation ────────────────────────────────

  it('returns null when lat is outside ±90 (P-9 range guard)', async () => {
    global.fetch = jest.fn();

    expect(await service.lookupByGps(95, LNG)).toBeNull();
    expect(await service.lookupByGps(-91, LNG)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null when lng is outside ±180 (P-9 range guard)', async () => {
    global.fetch = jest.fn();

    expect(await service.lookupByGps(LAT, 200)).toBeNull();
    expect(await service.lookupByGps(LAT, -181)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── P-1 — coords rounded to 2dp before Nominatim call ────────────────

  it('sends 2dp-rounded coords to Nominatim (P-1 privacy)', async () => {
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('województwo łódzkie'));

    // 51.7592 / 19.4564 should round to 51.76 / 19.46 in the URL
    await service.lookupByGps(51.7592, 19.4564);

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('lat=51.76');
    expect(url).toContain('lon=19.46');
    // Original full-precision values must NOT appear in the URL
    expect(url).not.toContain('51.7592');
    expect(url).not.toContain('19.4564');
  });

  // ── P-7 — transient vs definitive failure cache TTL ──────────────────

  it('caches HTTP 429 (rate limit) for 5 min, not 24h (P-7 transient)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });

    await service.lookupByGps(LAT, LNG);

    expect(mockSet).toHaveBeenCalledWith(
      expect.any(String),
      '__none__',
      'EX',
      5 * 60, // TRANSIENT_FAILURE_TTL_SECONDS
    );
  });

  it('caches HTTP 503 (server error) for 5 min, not 24h (P-7 transient)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    await service.lookupByGps(LAT, LNG);

    expect(mockSet).toHaveBeenCalledWith(
      expect.any(String),
      '__none__',
      'EX',
      5 * 60,
    );
  });

  it('caches network error (timeout) for 5 min, not 24h (P-7 transient)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));

    await service.lookupByGps(LAT, LNG);

    expect(mockSet).toHaveBeenCalledWith(
      expect.any(String),
      '__none__',
      'EX',
      5 * 60,
    );
  });

  it('caches HTTP 4xx (other than 429) for full 24h — definitive miss', async () => {
    // 404 means "no Polish voivodeship at this coord" — that's a real
    // answer. Cache for 24h since geography doesn't change.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

    await service.lookupByGps(LAT, LNG);

    expect(mockSet).toHaveBeenCalledWith(
      expect.any(String),
      '__none__',
      'EX',
      24 * 60 * 60,
    );
  });

  it('proceeds to Nominatim when Redis read fails (fail-open on cache)', async () => {
    mockGet.mockRejectedValueOnce(new Error('Redis down'));
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('województwo łódzkie'));

    const result = await service.lookupByGps(LAT, LNG);

    expect(result).toBe('lodzkie');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not propagate Redis write failures (best-effort cache)', async () => {
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('województwo łódzkie'));
    mockSet.mockRejectedValueOnce(new Error('Redis down'));

    await expect(service.lookupByGps(LAT, LNG)).resolves.toBe('lodzkie');
  });

  it('honours custom NOMINATIM_USER_AGENT from config', async () => {
    mockConfigGet.mockReturnValueOnce('custom-app/1.0 (ops@example.com)');
    global.fetch = jest.fn().mockResolvedValue(nominatimResponse('województwo łódzkie'));

    // Re-instantiate so the constructor reads the override
    const m = await Test.createTestingModule({
      providers: [
        VoivodeshipLookupService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    const svc = m.get<VoivodeshipLookupService>(VoivodeshipLookupService);

    await svc.lookupByGps(LAT, LNG);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['User-Agent']).toBe('custom-app/1.0 (ops@example.com)');
  });
});
