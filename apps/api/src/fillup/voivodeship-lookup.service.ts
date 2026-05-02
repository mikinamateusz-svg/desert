import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import {
  isValidVoivodeship,
  type VoivodeshipSlug,
} from '../station/config/voivodeship-slugs.js';

// ── Constants ──────────────────────────────────────────────────────────────

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_TIMEOUT_MS = 5_000;

// Cache TTL — voivodeship boundaries are stable, so a 24h cache is safe.
// Cache key uses lat/lng rounded to 2 dp (~1.1 km grid) so adjacent fill-ups
// share lookups and one user driving 100 m down the road doesn't trigger a
// fresh Nominatim hit.
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// P-7: shorter TTL for cached null when caused by a *transient* Nominatim
// failure (429 rate-limit, 5xx server error, network timeout). 5 min keeps
// us under their rate-limit policy if many users hit the same cell during
// the outage but doesn't poison the cache for a full day. Definitive
// failures (2xx with unmapped state, 4xx other than 429) still cache for
// 24h since the answer is genuinely "no Polish voivodeship here".
const TRANSIENT_FAILURE_TTL_SECONDS = 5 * 60;

// Sentinel value persisted to Redis when Nominatim couldn't resolve a slug.
// Distinguished from "key missing" so a definitive "not in PL" answer doesn't
// re-hit the network on every fill-up from the same area.
const CACHE_NULL_SENTINEL = '__none__';

// Default User-Agent. Nominatim's usage policy REQUIRES a contact-able UA
// — requests without one may be rate-limited or blocked outright. Read from
// env when available so deployments can stamp their own contact.
const DEFAULT_USER_AGENT = 'litro-app/2.0 (contact@litro.pl)';

// ── Types ──────────────────────────────────────────────────────────────────

interface NominatimAddress {
  state?: string;
  // Nominatim sometimes returns the voivodeship under a different key
  // depending on locale + zoom. We only consult `state` (the most stable
  // key for zoom=5) but we read defensively.
}

interface NominatimResponse {
  address?: NominatimAddress;
}

// State-name → slug map. Polish results from `accept-language=pl` arrive as
// "województwo X" but lowercase/trim normalisation handles whitespace and
// case drift across Nominatim updates.
const STATE_TO_SLUG: Record<string, VoivodeshipSlug> = {
  'województwo dolnośląskie': 'dolnoslaskie',
  'województwo kujawsko-pomorskie': 'kujawsko-pomorskie',
  'województwo lubelskie': 'lubelskie',
  'województwo lubuskie': 'lubuskie',
  'województwo łódzkie': 'lodzkie',
  'województwo małopolskie': 'malopolskie',
  'województwo mazowieckie': 'mazowieckie',
  'województwo opolskie': 'opolskie',
  'województwo podkarpackie': 'podkarpackie',
  'województwo podlaskie': 'podlaskie',
  'województwo pomorskie': 'pomorskie',
  'województwo śląskie': 'slaskie',
  'województwo świętokrzyskie': 'swietokrzyskie',
  'województwo warmińsko-mazurskie': 'warminsko-mazurskie',
  'województwo wielkopolskie': 'wielkopolskie',
  'województwo zachodniopomorskie': 'zachodniopomorskie',
};

// ── Service ────────────────────────────────────────────────────────────────

/**
 * Reverse-geocodes GPS coordinates to a Polish voivodeship slug via the
 * OpenStreetMap Nominatim API.
 *
 * Used by Story 5.3 to populate `FillUp.voivodeship` when a fill-up has no
 * matched station — without it, savings vs. area average can't be computed
 * for unmapped pumps.
 *
 * Privacy: GPS coords are rounded to 2 decimal places (~1.1 km grid)
 * before being included in the cache key — but the FULL coordinates are
 * sent to Nominatim. This is the first time GPS coords leave our
 * infrastructure to a third party (everything else is server-internal).
 * Privacy policy must be updated to disclose Nominatim before public launch.
 *
 * Reliability:
 *   - 5s timeout on the network call
 *   - On any failure (timeout, non-2xx, JSON parse error, unmapped state):
 *     returns null and caches the null result for 24h — never throws to
 *     the caller. Callers (FillupService) treat null as "no benchmark
 *     available", which is the same path as an unmapped voivodeship.
 *
 * Nominatim usage policy compliance:
 *   - Valid User-Agent header with contact info (REQUIRED, see
 *     https://operations.osmfoundation.org/policies/nominatim/)
 *   - 24h Redis cache means a single user drives at most 1 lookup per 1km²
 *   - 5s timeout caps backend wait
 *   - Single-request fail-silent — no retries that would amplify load
 */
@Injectable()
export class VoivodeshipLookupService {
  private readonly logger = new Logger(VoivodeshipLookupService.name);
  private readonly userAgent: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.userAgent =
      this.config.get<string>('NOMINATIM_USER_AGENT') ?? DEFAULT_USER_AGENT;
  }

  async lookupByGps(lat: number, lng: number): Promise<VoivodeshipSlug | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // P-9: coordinate range validation. lat outside ±90 / lng outside ±180
    // is geographically meaningless; reject early so we don't waste a
    // Nominatim call (or worse, a cache slot that gets a `null` entry).
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    // P-1, P-2: round coords to 2 dp (~1.1 km grid) BEFORE both cache key
    // construction AND the outbound URL — privacy posture is "GPS shared
    // with Nominatim is at city-block precision", not "10 m precision".
    // Same rounded values are also the only ones logged on warn paths.
    const roundedLat = this.round2dp(lat);
    const roundedLng = this.round2dp(lng);
    const cacheKey = `voivodeship:gps:${roundedLat.toFixed(2)}:${roundedLng.toFixed(2)}`;

    // Cache check — distinguish "cached null" (definitive miss) from
    // "key missing" (need to fetch).
    let cached: string | null = null;
    try {
      cached = await this.redis.get(cacheKey);
    } catch (e) {
      this.logger.warn(
        `Voivodeship cache read failed: ${e instanceof Error ? e.message : String(e)} — proceeding to Nominatim`,
      );
    }
    if (cached !== null) {
      if (cached === CACHE_NULL_SENTINEL) return null;
      return isValidVoivodeship(cached) ? cached : null;
    }

    // Network call. Two failure classes — see P-7 above:
    //   transient: HTTP 429 / 5xx / network error → cache null for 5 min
    //   definitive: HTTP 2xx with no mappable state → cache null for 24h
    let slug: VoivodeshipSlug | null = null;
    let cacheTtl = CACHE_TTL_SECONDS;
    try {
      const url = `${NOMINATIM_URL}?format=json&lat=${roundedLat}&lon=${roundedLng}&zoom=5&accept-language=pl`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
        headers: { 'User-Agent': this.userAgent },
      });
      if (!res.ok) {
        // P-2: log the rounded coords only — never the full-precision
        // input. Full precision in app logs leaks PII regardless of how
        // careful the on-disk DB is.
        this.logger.warn(
          `Nominatim returned ${res.status} for (${roundedLat.toFixed(2)}, ${roundedLng.toFixed(2)})`,
        );
        // 429 + 5xx are transient — short TTL so we recover quickly.
        if (res.status === 429 || res.status >= 500) {
          cacheTtl = TRANSIENT_FAILURE_TTL_SECONDS;
        }
      } else {
        const body = (await res.json()) as NominatimResponse;
        slug = this.mapStateToSlug(body?.address?.state);
      }
    } catch (e) {
      // Timeout / network error / parse error all funnel here. Treat as
      // transient — short TTL so a flaky network doesn't poison the cache
      // for a full day from the same 1km² cell.
      this.logger.warn(
        `Nominatim lookup failed for (${roundedLat.toFixed(2)}, ${roundedLng.toFixed(2)}): ${e instanceof Error ? e.message : String(e)}`,
      );
      cacheTtl = TRANSIENT_FAILURE_TTL_SECONDS;
    }

    // Cache the result (slug or null sentinel). Best-effort — Redis blip
    // here doesn't propagate; the next call will simply re-fetch.
    try {
      await this.redis.set(
        cacheKey,
        slug ?? CACHE_NULL_SENTINEL,
        'EX',
        cacheTtl,
      );
    } catch (e) {
      this.logger.warn(
        `Voivodeship cache write failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return slug;
  }

  /** Round to 2 decimal places using a multiplier-then-divide pattern that
   *  avoids `Number.toFixed`-then-parse round-tripping. ~1.1 km precision. */
  private round2dp(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private mapStateToSlug(state: string | undefined): VoivodeshipSlug | null {
    if (typeof state !== 'string') return null;
    const normalised = state.toLowerCase().trim();
    return STATE_TO_SLUG[normalised] ?? null;
  }
}
