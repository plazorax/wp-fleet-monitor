import { describeNetworkError } from './errors.ts';

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  headers: Headers;
  body: string;
  /** Time until the whole body was read. */
  durationMs: number;
}

export interface HttpClient {
  get(url: string, accept?: string): Promise<HttpResponse>;
}

/** A request that produced no HTTP response (DNS, connection, TLS or timeout). */
export class RequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RequestError';
  }
}

export interface HttpClientOptions {
  fetch: FetchFn;
  timeoutMs: number;
  userAgent: string;
  now: () => number;
}

function describe(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return `timed out after ${timeoutMs} ms`;
    // Node's fetch reports "fetch failed" and keeps the useful part in `cause`.
    if (error.cause instanceof Error) return describeNetworkError(error.cause);
  }
  return describeNetworkError(error);
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { fetch, timeoutMs, userAgent, now } = options;
  return {
    async get(url, accept = '*/*') {
      const started = now();
      try {
        const response = await fetch(url, {
          headers: { 'user-agent': userAgent, accept },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.text();
        return {
          status: response.status,
          url: response.url || url,
          headers: response.headers,
          body,
          durationMs: Math.round(now() - started),
        };
      } catch (error) {
        throw new RequestError(describe(error, timeoutMs), { cause: error });
      }
    },
  };
}
