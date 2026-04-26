/**
 * Lightweight fetch mock for admin server-action tests.
 *
 * We use jest.spyOn(global, 'fetch') instead of msw because msw v2 ships ESM
 * internals that don't play with Jest's CommonJS runtime without significant
 * config gymnastics. fetch-spy gets us the same coverage with one helper.
 *
 * Pattern in a test file:
 *
 *   import { mockFetchOnce, resetFetchMock } from '../test/fetch-mock';
 *
 *   beforeEach(() => resetFetchMock());
 *   afterAll(() => restoreFetch());
 *
 *   it('returns data on 2xx', async () => {
 *     mockFetchOnce({ status: 200, body: { ok: true } });
 *     const result = await someServerAction();
 *     expect(result).toEqual({ ok: true });
 *   });
 *
 * Each call to mockFetchOnce queues one response. The mock asserts that
 * exactly N requests were made if the test reads `getFetchCalls().length`.
 */

interface MockResponseInit {
  status?: number;
  body?: unknown;
  textBody?: string;
  headers?: Record<string, string>;
}

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  cache: string | null;
}

let originalFetch: typeof globalThis.fetch | null = null;
let fetchSpy: jest.SpyInstance | null = null;
const captured: CapturedCall[] = [];

function buildResponse(init: MockResponseInit): Response {
  const status = init.status ?? 200;
  const headers = new Headers({ 'Content-Type': 'application/json', ...(init.headers ?? {}) });
  const bodyStr =
    init.textBody !== undefined
      ? init.textBody
      : init.body !== undefined
        ? JSON.stringify(init.body)
        : '';
  return new Response(bodyStr, { status, headers });
}

function ensureSpy(): void {
  if (fetchSpy) return;
  if (!originalFetch) originalFetch = globalThis.fetch;
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers: Record<string, string> = {};
      const rawHeaders = init?.headers ?? {};
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(rawHeaders)) {
        for (const [k, v] of rawHeaders) headers[k] = v;
      } else {
        Object.assign(headers, rawHeaders);
      }
      captured.push({
        url,
        method,
        headers,
        body: typeof init?.body === 'string' ? init.body : null,
        cache: (init?.cache as string | undefined) ?? null,
      });
      const next = queue.shift();
      if (!next) {
        if (failOnUnmocked) {
          throw new Error(`[fetch-mock] Unmocked request: ${method} ${url}. Add mockFetchOnce(...) before the call.`);
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (next.kind === 'response') return buildResponse(next.init);
      throw next.error;
    },
  );
}

type QueueEntry =
  | { kind: 'response'; init: MockResponseInit }
  | { kind: 'error'; error: Error };

const queue: QueueEntry[] = [];
let failOnUnmocked = true;

export function mockFetchOnce(init: MockResponseInit): void {
  ensureSpy();
  queue.push({ kind: 'response', init });
}

export function mockFetchErrorOnce(error: Error): void {
  ensureSpy();
  queue.push({ kind: 'error', error });
}

export function resetFetchMock(): void {
  queue.length = 0;
  captured.length = 0;
  failOnUnmocked = true;
}

export function getFetchCalls(): CapturedCall[] {
  return [...captured];
}

export function restoreFetch(): void {
  fetchSpy?.mockRestore();
  fetchSpy = null;
  originalFetch = null;
  queue.length = 0;
  captured.length = 0;
}
