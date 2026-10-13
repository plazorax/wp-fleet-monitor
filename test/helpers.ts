import { vi } from 'vitest';
import type { FetchFn } from '../src/http.ts';
import type { Deps } from '../src/site.ts';
import { createHttpClient } from '../src/http.ts';
import type { CertificateInfo, TlsProbe } from '../src/tls.ts';
import type { CheckResult, SiteResult } from '../src/types.ts';
import { CORE_VERSION_URL, createWordPressOrg } from '../src/wporg.ts';

export const NOW = new Date('2026-10-13T12:00:00Z');

/** Trimmed version-check/1.7 response with the same shape as the live API. */
export const CORE_RELEASES = {
  offers: [
    { response: 'upgrade', current: '7.1.3', version: '7.1.3' },
    { response: 'autoupdate', current: '7.1.3', version: '7.1.3' },
    { response: 'autoupdate', current: '7.0.7', version: '7.0.7' },
    { response: 'autoupdate', current: '6.9.10', version: '6.9.10' },
  ],
  translations: [],
};

export type Route = Response | (() => Response | Promise<Response>) | Error;

/**
 * A fetch mock that answers by exact URL (query string included). Unknown URLs get a 404,
 * so tests only describe what matters. Every requested URL is recorded in `calls`.
 */
export function mockFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetch = vi.fn<FetchFn>(async (input) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route instanceof Response) return route.clone();
    if (route) return route();
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } });
  });
  return { fetch, calls };
}

export function html(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': 'text/html; charset=UTF-8', ...init.headers },
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

export function certificate(overrides: Partial<CertificateInfo> = {}): CertificateInfo {
  return {
    validTo: new Date('2027-01-01T00:00:00Z'),
    authorized: true,
    authorizationError: null,
    issuer: 'Test CA',
    ...overrides,
  };
}

export function mockTls(result: CertificateInfo | Error = certificate()) {
  return vi.fn<TlsProbe>(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
}

/** Deps with a fixed clock: every request appears to take `durationMs`. */
export function makeDeps(fetch: FetchFn, tls: TlsProbe = mockTls(), durationMs = 100): Deps {
  let tick = 0;
  const now = () => (tick++ % 2 === 0 ? 0 : durationMs);
  const http = createHttpClient({ fetch, timeoutMs: 5_000, userAgent: 'test-agent', now });
  return { http, tls, wporg: createWordPressOrg(http), now: () => NOW };
}

export const coreRoute = { [CORE_VERSION_URL]: json(CORE_RELEASES) };

export function byId(site: SiteResult, id: string): CheckResult {
  const check = site.checks.find((item) => item.id === id);
  if (!check) throw new Error(`no ${id} check in ${site.checks.map((item) => item.id).join(', ')}`);
  return check;
}
