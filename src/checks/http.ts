import type { HttpResponse } from '../http.ts';
import type { CheckResult, Range } from '../types.ts';

export type HttpOutcome = { response: HttpResponse } | { error: string };

/**
 * Home page availability and speed.
 * - no response (DNS, connect, TLS, timeout) -> fail
 * - HTTP 4xx/5xx after redirects -> fail
 * - fetch time >= fail threshold -> fail; >= warn threshold -> warn
 */
export function evaluateHttp(outcome: HttpOutcome, thresholds: Range, requestedUrl: string): CheckResult {
  if ('error' in outcome) {
    return { id: 'http', status: 'fail', summary: 'down', message: `Request failed: ${outcome.error}` };
  }
  const { status, durationMs, url } = outcome.response;
  const summary = `${status} ${durationMs} ms`;
  const redirect = url !== requestedUrl ? ` (redirected to ${url})` : '';
  if (status >= 400) {
    return { id: 'http', status: 'fail', summary, message: `Home page returned HTTP ${status}${redirect}.` };
  }
  if (durationMs >= thresholds.fail) {
    return {
      id: 'http',
      status: 'fail',
      summary,
      message: `Home page took ${durationMs} ms (fail at ${thresholds.fail} ms).`,
    };
  }
  if (durationMs >= thresholds.warn) {
    return {
      id: 'http',
      status: 'warn',
      summary,
      message: `Home page took ${durationMs} ms (warn at ${thresholds.warn} ms).`,
    };
  }
  return { id: 'http', status: 'ok', summary, message: `HTTP ${status} in ${durationMs} ms${redirect}.` };
}
