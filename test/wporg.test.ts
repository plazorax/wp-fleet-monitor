import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../src/http.ts';
import { CORE_VERSION_URL, createWordPressOrg, parseCoreReleases, pluginInfoUrl } from '../src/wporg.ts';
import { CORE_RELEASES, json, mockFetch, type Route } from './helpers.ts';

function client(routes: Record<string, Route>) {
  const { fetch, calls } = mockFetch(routes);
  const http = createHttpClient({ fetch, timeoutMs: 1000, userAgent: 'test', now: () => 0 });
  return { wporg: createWordPressOrg(http), calls };
}

describe('parseCoreReleases', () => {
  it('finds the latest release and the newest release per branch', () => {
    const { latest, branches } = parseCoreReleases(CORE_RELEASES);
    expect(latest.raw).toBe('7.1.3');
    expect([...branches].map(([branch, version]) => `${branch}=${version.raw}`)).toEqual([
      '7.1=7.1.3',
      '7.0=7.0.7',
      '6.9=6.9.10',
    ]);
  });

  it('rejects unexpected shapes', () => {
    expect(() => parseCoreReleases({})).toThrow('no offers');
    expect(() => parseCoreReleases({ offers: [{ current: 'x' }] })).toThrow('no usable versions');
  });
});

describe('pluginInfoUrl', () => {
  it('builds a plugin_information URL without the heavy fields', () => {
    const url = new URL(pluginInfoUrl('akismet'));
    expect(url.origin + url.pathname).toBe('https://api.wordpress.org/plugins/info/1.2/');
    expect(url.searchParams.get('action')).toBe('plugin_information');
    expect(url.searchParams.get('request[slug]')).toBe('akismet');
    expect(url.searchParams.get('request[fields][sections]')).toBe('0');
  });
});

describe('createWordPressOrg', () => {
  it('fetches core releases once and rejects on HTTP errors', async () => {
    const ok = client({ [CORE_VERSION_URL]: json(CORE_RELEASES) });
    await Promise.all([ok.wporg.coreReleases(), ok.wporg.coreReleases()]);
    expect(ok.calls).toEqual([CORE_VERSION_URL]);

    const down = client({ [CORE_VERSION_URL]: json({}, 503) });
    await expect(down.wporg.coreReleases()).rejects.toThrow('version-check returned HTTP 503');
  });

  it('maps plugin responses', async () => {
    const { wporg, calls } = client({
      [pluginInfoUrl('akismet')]: json({ slug: 'akismet', version: '5.7.2' }),
      [pluginInfoUrl('missing')]: json({ error: 'Plugin not found.' }, 404),
      [pluginInfoUrl('closed-one')]: json(
        {
          error: 'closed',
          closed: true,
          closed_date: '2024-02-23',
          reason: 'author-request',
          reason_text: 'Author Request',
        },
        404,
      ),
      [pluginInfoUrl('broken')]: json({}, 500),
      [pluginInfoUrl('offline')]: new TypeError('fetch failed'),
    });

    expect(await wporg.plugin('akismet')).toMatchObject({ status: 'found', version: { raw: '5.7.2' } });
    expect(await wporg.plugin('missing')).toEqual({ status: 'unavailable', reason: 'not found on WordPress.org' });
    expect(await wporg.plugin('closed-one')).toEqual({
      status: 'closed',
      date: '2024-02-23',
      reason: 'author-request',
      reasonText: 'Author Request',
    });
    expect(await wporg.plugin('broken')).toEqual({
      status: 'unavailable',
      reason: 'WordPress.org API returned HTTP 500',
    });
    expect(await wporg.plugin('offline')).toEqual({
      status: 'unavailable',
      reason: 'WordPress.org lookup failed: fetch failed',
    });

    await wporg.plugin('akismet');
    expect(calls.filter((url) => url === pluginInfoUrl('akismet'))).toHaveLength(1);
  });
});
