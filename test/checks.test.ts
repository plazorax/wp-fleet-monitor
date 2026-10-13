import { describe, expect, it } from 'vitest';
import { evaluateHttp } from '../src/checks/http.ts';
import { evaluatePlugin } from '../src/checks/plugin.ts';
import { evaluateRest } from '../src/checks/rest.ts';
import { daysUntil, evaluateTls } from '../src/checks/tls.ts';
import { evaluateWordPress, type Detection } from '../src/checks/wordpress.ts';
import type { HttpResponse } from '../src/http.ts';
import { parseVersion, type Version } from '../src/version.ts';
import { parseCoreReleases, type PluginLookup } from '../src/wporg.ts';
import { CORE_RELEASES, NOW, certificate } from './helpers.ts';

function v(input: string): Version {
  const parsed = parseVersion(input);
  if (!parsed) throw new Error(input);
  return parsed;
}

describe('evaluateHttp', () => {
  const thresholds = { warn: 1000, fail: 3000 };
  const url = 'https://example.com/';
  const response = (status: number, durationMs: number, finalUrl = url): { response: HttpResponse } => ({
    response: { status, durationMs, url: finalUrl, headers: new Headers(), body: '' },
  });

  it.each([
    [200, 999, 'ok'],
    [200, 1000, 'warn'],
    [200, 2999, 'warn'],
    [200, 3000, 'fail'],
    [404, 50, 'fail'],
    [503, 50, 'fail'],
  ] as const)('HTTP %i in %i ms -> %s', (status, ms, expected) => {
    expect(evaluateHttp(response(status, ms), thresholds, url).status).toBe(expected);
  });

  it('fails when there is no response', () => {
    expect(evaluateHttp({ error: 'ENOTFOUND example.com' }, thresholds, url)).toEqual({
      id: 'http',
      status: 'fail',
      summary: 'down',
      message: 'Request failed: ENOTFOUND example.com',
    });
  });

  it('mentions redirects', () => {
    const result = evaluateHttp(response(200, 10, 'https://www.example.com/'), thresholds, url);
    expect(result).toMatchObject({ status: 'ok', summary: '200 10 ms' });
    expect(result.message).toContain('redirected to https://www.example.com/');
  });
});

describe('evaluateTls', () => {
  const thresholds = { warn: 21, fail: 7 };
  const expiringIn = (days: number) =>
    certificate({ validTo: new Date(NOW.getTime() + days * 86_400_000 + 3_600_000) });

  it('counts whole days left', () => {
    expect(daysUntil(new Date('2026-10-20T11:00:00Z'), NOW)).toBe(6);
    expect(daysUntil(new Date('2026-10-13T11:00:00Z'), NOW)).toBe(-1);
  });

  it.each([
    [90, 'ok'],
    [22, 'ok'],
    [21, 'warn'],
    [8, 'warn'],
    [7, 'fail'],
    [0, 'fail'],
  ] as const)('%i days left -> %s', (days, expected) => {
    expect(evaluateTls({ certificate: expiringIn(days) }, thresholds, NOW)).toMatchObject({
      status: expected,
      summary: `${days} days`,
    });
  });

  it('fails an expired certificate even if the expiry is the only problem', () => {
    const result = evaluateTls(
      { certificate: certificate({ validTo: new Date('2026-10-01T00:00:00Z') }) },
      thresholds,
      NOW,
    );
    expect(result).toMatchObject({ status: 'fail', summary: 'expired', message: 'Certificate expired on 2026-10-01.' });
  });

  it('fails an untrusted certificate with plenty of days left', () => {
    const result = evaluateTls(
      { certificate: certificate({ authorized: false, authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID' }) },
      thresholds,
      NOW,
    );
    expect(result).toMatchObject({ status: 'fail', summary: 'untrusted' });
    expect(result.message).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('fails on handshake errors and warns on plain http', () => {
    expect(evaluateTls({ error: 'ECONNREFUSED' }, thresholds, NOW).status).toBe('fail');
    expect(evaluateTls({ notHttps: true }, thresholds, NOW)).toMatchObject({ status: 'warn', summary: 'no https' });
  });
});

describe('evaluateRest', () => {
  it.each([
    [{ status: 200, namespaces: ['oembed/1.0', 'wp/v2'] }, 'ok'],
    [{ status: 200, namespaces: ['oembed/1.0'] }, 'warn'],
    [{ status: 401, namespaces: null }, 'warn'],
    [{ status: 403, namespaces: null }, 'warn'],
    [{ status: 404, namespaces: null }, 'fail'],
    [{ status: 200, namespaces: null }, 'fail'],
    [{ status: 500, namespaces: null }, 'fail'],
    [{ error: 'timed out after 5000 ms' }, 'fail'],
  ] as const)('%j -> %s', (outcome, expected) => {
    expect(evaluateRest(outcome as Parameters<typeof evaluateRest>[0]).status).toBe(expected);
  });

  it('explains a non-JSON 200', () => {
    expect(evaluateRest({ status: 200, namespaces: null }).message).toBe(
      'REST API index returned a response that is not a REST API index.',
    );
  });
});

describe('evaluateWordPress', () => {
  const releases = { releases: parseCoreReleases(CORE_RELEASES) };
  const detected = (version: string | null): Detection => ({ signals: ['rest-link'], version });

  it.each([
    ['7.1.3', 'ok', '7.1.3'],
    ['7.2-alpha-64319', 'ok', '7.2-alpha-64319'],
    ['7.1.1', 'fail', '7.1.1 < 7.1.3'],
    ['7.1', 'fail', '7.1 < 7.1.3'],
    ['7.0.7', 'warn', '7.0.7 < 7.1.3'],
    ['6.9.10', 'warn', '6.9.10 < 7.1.3'],
    ['6.9.8', 'fail', '6.9.8 < 7.1.3'],
    ['6.4.2', 'fail', '6.4.2 < 7.1.3'],
  ] as const)('core %s -> %s', (version, status, summary) => {
    expect(evaluateWordPress(detected(version), releases)).toMatchObject({ status, summary });
  });

  it('explains each outdated case', () => {
    expect(evaluateWordPress(detected('6.9.10'), releases).message).toBe(
      'Core 6.9.10 is the newest 6.9.x release but 7.1.3 is available.',
    );
    expect(evaluateWordPress(detected('6.9.8'), releases).message).toBe(
      'Core 6.9.8 is missing 6.9.10, the newest 6.9.x release; latest is 7.1.3.',
    );
    expect(evaluateWordPress(detected('6.4.2'), releases).message).toBe(
      'Core 6.4.2: branch 6.4 no longer receives security releases; latest is 7.1.3.',
    );
    expect(evaluateWordPress(detected('7.2-alpha-64319'), releases).message).toContain('ahead of latest release 7.1.3');
  });

  it('warns when WordPress is not detected at all', () => {
    const result = evaluateWordPress({ signals: [], version: null }, releases);
    expect(result).toMatchObject({ status: 'warn', summary: 'not detected' });
  });

  it('is unknown when the version is hidden, unparsable or cannot be compared', () => {
    expect(evaluateWordPress(detected(null), releases)).toMatchObject({
      status: 'unknown',
      summary: 'hidden',
      message: 'WordPress detected (rest-link) but the core version is not public.',
    });
    expect(evaluateWordPress(detected('custom'), releases).status).toBe('unknown');
    expect(evaluateWordPress(detected('7.1.3'), { error: 'HTTP 503' })).toMatchObject({
      status: 'unknown',
      message: 'Core 7.1.3; latest release unavailable: HTTP 503',
    });
  });
});

describe('evaluatePlugin', () => {
  const latest: PluginLookup = { status: 'found', version: v('5.7.2') };

  it.each([
    ['5.7.2', 'ok'],
    ['5.8.0', 'ok'],
    ['5.7.1', 'warn'],
    ['4.0', 'warn'],
  ] as const)('installed %s vs 5.7.2 -> %s', (installed, status) => {
    expect(evaluatePlugin('akismet', { stableTag: installed }, latest)).toMatchObject({ id: 'plugin:akismet', status });
  });

  it('is unknown when the readme is not readable', () => {
    expect(evaluatePlugin('akismet', { reason: 'not publicly readable (HTTP 403)' }, latest)).toEqual({
      id: 'plugin:akismet',
      status: 'unknown',
      summary: '?',
      message: 'readme.txt not publicly readable (HTTP 403).',
    });
  });

  it('is unknown when the stable tag is not a version', () => {
    expect(evaluatePlugin('akismet', { stableTag: 'trunk' }, latest)).toMatchObject({
      status: 'unknown',
      summary: 'trunk',
    });
  });

  it('is unknown when the plugin is not on WordPress.org', () => {
    const result = evaluatePlugin(
      'custom-plugin',
      { stableTag: '1.0' },
      { status: 'unavailable', reason: 'not found on WordPress.org' },
    );
    expect(result).toMatchObject({ status: 'unknown', message: 'Installed 1.0; not found on WordPress.org.' });
  });

  it('fails a plugin closed for a security issue, even when the readme is hidden', () => {
    const closed: PluginLookup = {
      status: 'closed',
      date: '2021-01-30',
      reason: 'security-issue',
      reasonText: 'Security Issue',
    };
    expect(evaluatePlugin('display-widgets', { reason: 'not publicly readable (HTTP 403)' }, closed)).toEqual({
      id: 'plugin:display-widgets',
      status: 'fail',
      summary: 'closed',
      message: 'Closed on WordPress.org since 2021-01-30 (Security Issue); it gets no updates.',
    });
  });

  it('warns about a plugin closed for any other reason', () => {
    const closed: PluginLookup = { status: 'closed', date: null, reason: 'author-request', reasonText: null };
    expect(evaluatePlugin('old-plugin', { stableTag: '1.0' }, closed)).toMatchObject({
      status: 'warn',
      message: 'Closed on WordPress.org (author-request); it gets no updates.',
    });
  });
});
