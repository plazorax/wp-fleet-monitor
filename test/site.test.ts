import { describe, expect, it } from 'vitest';
import { runFleet } from '../src/run.ts';
import { checkSite } from '../src/site.ts';
import type { FleetConfig, SiteConfig } from '../src/types.ts';
import { CORE_VERSION_URL, pluginInfoUrl } from '../src/wporg.ts';
import { NOW, byId, certificate, coreRoute, html, json, makeDeps, mockFetch, mockTls, text } from './helpers.ts';

const options = {
  thresholds: { responseTimeMs: { warn: 2000, fail: 8000 }, sslDays: { warn: 21, fail: 7 } },
  timeoutMs: 5000,
};

function site(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return { name: 'Example', url: 'https://example.com/', tags: [], plugins: [], ...overrides };
}

const restUrl = (root: string) => `${root}?_fields=name%2Cnamespaces`;
const HOME = html('<html><head><meta name="generator" content="WordPress 7.1.3" /></head></html>', {
  headers: { link: '<https://example.com/wp-json/>; rel="https://api.w.org/"' },
});
const REST_OK = json({ name: 'Example', namespaces: ['oembed/1.0', 'wp/v2'] });
const AKISMET_README = text('=== Akismet ===\nStable tag: 5.7.2\n');
const AKISMET_INFO = json({ name: 'Akismet', slug: 'akismet', version: '5.7.2' });

describe('checkSite', () => {
  it('reports a healthy site', async () => {
    const { fetch, calls } = mockFetch({
      'https://example.com/': HOME,
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      'https://example.com/wp-content/plugins/akismet/readme.txt': AKISMET_README,
      [pluginInfoUrl('akismet')]: AKISMET_INFO,
      ...coreRoute,
    });
    const tls = mockTls();
    const result = await checkSite(site({ plugins: ['akismet'] }), options, makeDeps(fetch, tls));

    expect(result.status).toBe('ok');
    expect(result.checks.map((check) => [check.id, check.status, check.summary])).toEqual([
      ['http', 'ok', '200 100 ms'],
      ['tls', 'ok', '79 days'],
      ['wordpress', 'ok', '7.1.3'],
      ['rest', 'ok', 'ok'],
      ['plugin:akismet', 'ok', '5.7.2'],
    ]);
    expect(tls).toHaveBeenCalledWith('example.com', 443, 5000);
    // The generator tag gave the version, so the feed is never requested.
    expect(calls).not.toContain('https://example.com/?feed=rss2');
  });

  it('falls back to the feed when the generator tag is removed', async () => {
    const { fetch } = mockFetch({
      'https://example.com/': html('<html></html>'),
      'https://example.com/?feed=rss2': new Response(
        '<rss><channel><generator>https://wordpress.org/?v=6.9.8</generator></channel></rss>',
      ),
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      ...coreRoute,
    });
    const result = await checkSite(site(), options, makeDeps(fetch));
    expect(byId(result, 'wordpress')).toMatchObject({ status: 'fail', summary: '6.9.8 < 7.1.3' });
    expect(result.status).toBe('fail');
  });

  it('marks the version unknown when only the REST API gives WordPress away', async () => {
    const { fetch, calls } = mockFetch({
      'https://example.com/': html('<html></html>'),
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      ...coreRoute,
    });
    const result = await checkSite(site(), options, makeDeps(fetch));
    expect(byId(result, 'wordpress')).toMatchObject({
      status: 'unknown',
      message: 'WordPress detected (rest-namespace) but the core version is not public.',
    });
    expect(result.status).toBe('ok');
    // No version to compare, so the core API is not called.
    expect(calls).not.toContain(CORE_VERSION_URL);
  });

  it('skips WordPress checks when the home page is unreachable but still checks TLS', async () => {
    const { fetch } = mockFetch({
      'https://example.com/': new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND example.com'), { code: 'ENOTFOUND' }),
      }),
    });
    const result = await checkSite(
      site({ plugins: ['akismet'] }),
      options,
      makeDeps(fetch, mockTls(new Error('ECONNREFUSED'))),
    );
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ['http', 'fail'],
      ['tls', 'fail'],
      ['wordpress', 'skip'],
      ['rest', 'skip'],
      ['plugin:akismet', 'skip'],
    ]);
    expect(byId(result, 'http').message).toBe('Request failed: getaddrinfo ENOTFOUND example.com');
  });

  it('reports a timeout', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { fetch } = mockFetch({ 'https://example.com/': () => Promise.reject(timeout) });
    const result = await checkSite(site(), options, makeDeps(fetch));
    expect(byId(result, 'http').message).toBe('Request failed: timed out after 5000 ms');
  });

  it('uses the advertised REST root and the site path for sub-directory installs', async () => {
    const { fetch, calls } = mockFetch({
      'https://example.com/blog/': html('<meta name="generator" content="WordPress 7.1.3">', {
        headers: { link: '<https://example.com/blog/?rest_route=/>; rel="https://api.w.org/"' },
      }),
      'https://example.com/blog/?rest_route=%2F&_fields=name%2Cnamespaces': REST_OK,
      'https://example.com/blog/wp-content/plugins/akismet/readme.txt': AKISMET_README,
      [pluginInfoUrl('akismet')]: AKISMET_INFO,
      ...coreRoute,
    });
    const result = await checkSite(
      site({ url: 'https://example.com/blog/', plugins: ['akismet'] }),
      options,
      makeDeps(fetch),
    );
    expect(calls).toContain('https://example.com/blog/?rest_route=%2F&_fields=name%2Cnamespaces');
    expect(result.status).toBe('ok');
  });

  it('resolves a relative REST link element against the home page URL', async () => {
    const { fetch, calls } = mockFetch({
      'https://example.com/': html(
        '<link rel="https://api.w.org/" href="/api/" /><meta name="generator" content="WordPress 7.1.3">',
      ),
      [restUrl('https://example.com/api/')]: REST_OK,
      ...coreRoute,
    });
    const result = await checkSite(site(), options, makeDeps(fetch));
    expect(calls).toContain(restUrl('https://example.com/api/'));
    expect(byId(result, 'rest').status).toBe('ok');
  });

  it('marks plugins unknown when readme.txt is blocked or answered with an HTML page', async () => {
    const { fetch } = mockFetch({
      'https://example.com/': HOME,
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      'https://example.com/wp-content/plugins/akismet/readme.txt': text('Forbidden', 403),
      // A soft 404: the theme answers 200 with an HTML page.
      'https://example.com/wp-content/plugins/jetpack/readme.txt': html('<h1>Page not found</h1>'),
      [pluginInfoUrl('akismet')]: AKISMET_INFO,
      [pluginInfoUrl('jetpack')]: json({ version: '16.3.1' }),
      ...coreRoute,
    });
    const result = await checkSite(site({ plugins: ['akismet', 'jetpack'] }), options, makeDeps(fetch));
    expect(byId(result, 'plugin:akismet')).toMatchObject({
      status: 'unknown',
      message: 'readme.txt not publicly readable (HTTP 403).',
    });
    expect(byId(result, 'plugin:jetpack')).toMatchObject({
      status: 'unknown',
      message: 'readme.txt URL returned an HTML page.',
    });
    expect(result.status).toBe('ok');
  });

  it('fails a configured plugin that WordPress.org closed for a security issue', async () => {
    const { fetch } = mockFetch({
      'https://example.com/': HOME,
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      [pluginInfoUrl('display-widgets')]: json(
        {
          error: 'closed',
          closed: true,
          closed_date: '2021-01-30',
          reason: 'security-issue',
          reason_text: 'Security Issue',
        },
        404,
      ),
      ...coreRoute,
    });
    const result = await checkSite(site({ plugins: ['display-widgets'] }), options, makeDeps(fetch));
    expect(byId(result, 'plugin:display-widgets')).toMatchObject({ status: 'fail', summary: 'closed' });
    expect(result.status).toBe('fail');
  });

  it('warns about an outdated plugin', async () => {
    const { fetch } = mockFetch({
      'https://example.com/': HOME,
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      'https://example.com/wp-content/plugins/akismet/readme.txt': text('Stable tag: 5.6\n'),
      [pluginInfoUrl('akismet')]: AKISMET_INFO,
      ...coreRoute,
    });
    const result = await checkSite(site({ plugins: ['akismet'] }), options, makeDeps(fetch));
    expect(byId(result, 'plugin:akismet')).toMatchObject({ status: 'warn', summary: '5.6 < 5.7.2' });
    expect(result.status).toBe('warn');
  });

  it('does not probe TLS for http:// sites', async () => {
    const { fetch } = mockFetch({ 'http://example.com/': HOME, ...coreRoute });
    const tls = mockTls();
    const result = await checkSite(site({ url: 'http://example.com/' }), options, makeDeps(fetch, tls));
    expect(tls).not.toHaveBeenCalled();
    expect(byId(result, 'tls')).toMatchObject({ status: 'warn', summary: 'no https' });
  });

  it('applies response time thresholds to the measured duration', async () => {
    const { fetch } = mockFetch({
      'https://example.com/': HOME,
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      ...coreRoute,
    });
    const result = await checkSite(site(), options, makeDeps(fetch, mockTls(certificate()), 2500));
    expect(byId(result, 'http')).toMatchObject({ status: 'warn', summary: '200 2500 ms' });
  });
});

describe('runFleet', () => {
  const config = (sites: SiteConfig[]): FleetConfig => ({
    concurrency: 2,
    timeoutMs: 5000,
    userAgent: 'test',
    exitOn: 'fail',
    thresholds: options.thresholds,
    slack: null,
    sites,
  });

  it('summarises sites and asks WordPress.org once per run', async () => {
    const { fetch, calls } = mockFetch({
      'https://a.example/': HOME,
      'https://b.example/': HOME,
      [restUrl('https://example.com/wp-json/')]: REST_OK,
      'https://a.example/wp-content/plugins/akismet/readme.txt': AKISMET_README,
      'https://b.example/wp-content/plugins/akismet/readme.txt': text('Stable tag: 5.0\n'),
      [pluginInfoUrl('akismet')]: AKISMET_INFO,
      ...coreRoute,
    });
    const seen: string[] = [];
    const report = await runFleet(
      config([
        site({ name: 'A', url: 'https://a.example/', plugins: ['akismet'] }),
        site({ name: 'B', url: 'https://b.example/', plugins: ['akismet'] }),
        site({ name: 'C', url: 'https://c.example/' }),
      ]),
      makeDeps(fetch),
      { onSite: (result) => seen.push(result.name) },
    );

    expect(report.sites.map((result) => [result.name, result.status])).toEqual([
      ['A', 'ok'],
      ['B', 'warn'],
      ['C', 'fail'],
    ]);
    expect(report.summary).toEqual({ ok: 1, warn: 1, fail: 1, total: 3 });
    expect(report.status).toBe('fail');
    expect(report.generatedAt).toBe('2026-10-13T12:00:00.000Z');
    expect(seen.sort()).toEqual(['A', 'B', 'C']);
    expect(calls.filter((url) => url === CORE_VERSION_URL)).toHaveLength(1);
    expect(calls.filter((url) => url === pluginInfoUrl('akismet'))).toHaveLength(1);
  });

  it('turns an unexpected error into a failed site instead of aborting the run', async () => {
    const { fetch } = mockFetch({ 'https://example.com/': HOME });
    let clockCalls = 0;
    const deps = {
      ...makeDeps(fetch),
      // The first call happens inside checkSite; later ones (the report timestamp) work.
      now: () => {
        if (clockCalls++ === 0) throw new Error('clock broke');
        return NOW;
      },
    };
    const report = await runFleet(config([site()]), deps);
    expect(report.status).toBe('fail');
    expect(report.sites[0]?.checks).toEqual([
      { id: 'internal', status: 'fail', summary: 'error', message: 'Unexpected error: Error: clock broke' },
    ]);
  });
});
