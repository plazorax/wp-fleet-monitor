import type { CertificateInfo } from '../tls.ts';
import type { CheckResult, Range } from '../types.ts';

export type TlsOutcome = { certificate: CertificateInfo } | { error: string } | { notHttps: true };

const DAY_MS = 86_400_000;

export function daysUntil(date: Date, now: Date): number {
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Certificate validity and expiry.
 * - site configured with http:// -> warn
 * - handshake failed -> fail
 * - expired, or days left <= fail threshold -> fail
 * - chain or hostname not trusted -> fail
 * - days left <= warn threshold -> warn
 */
export function evaluateTls(outcome: TlsOutcome, thresholds: Range, now: Date): CheckResult {
  if ('notHttps' in outcome) {
    return { id: 'tls', status: 'warn', summary: 'no https', message: 'Site URL uses plain http://.' };
  }
  if ('error' in outcome) {
    return { id: 'tls', status: 'fail', summary: 'error', message: `TLS handshake failed: ${outcome.error}` };
  }
  const { validTo, authorized, authorizationError } = outcome.certificate;
  const days = daysUntil(validTo, now);
  const expires = validTo.toISOString().slice(0, 10);
  const summary = `${days} days`;
  if (days < 0) {
    return { id: 'tls', status: 'fail', summary: 'expired', message: `Certificate expired on ${expires}.` };
  }
  if (!authorized) {
    return {
      id: 'tls',
      status: 'fail',
      summary: 'untrusted',
      message: `Certificate is not trusted: ${authorizationError ?? 'unknown verification error'}.`,
    };
  }
  if (days <= thresholds.fail) {
    return { id: 'tls', status: 'fail', summary, message: `Certificate expires in ${days} days (${expires}).` };
  }
  if (days <= thresholds.warn) {
    return { id: 'tls', status: 'warn', summary, message: `Certificate expires in ${days} days (${expires}).` };
  }
  return { id: 'tls', status: 'ok', summary, message: `Certificate valid until ${expires}.` };
}
