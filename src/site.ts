import { evaluateHttp, type HttpOutcome } from './checks/http.ts';
import { evaluatePlugin, type InstalledOutcome } from './checks/plugin.ts';
import { evaluateRest, type RestOutcome } from './checks/rest.ts';
import { evaluateTls, type TlsOutcome } from './checks/tls.ts';
import { evaluateWordPress, type Detection, type DetectionSignal, type ReleasesOutcome } from './checks/wordpress.ts';
import {
  restNamespaces,
  restRootFromHtml,
  restRootFromLinkHeader,
  stableTagFromReadme,
  versionFromFeed,
  versionFromGeneratorMeta,
} from './detect.ts';
import { describeNetworkError } from './errors.ts';
import type { HttpClient, HttpResponse } from './http.ts';
import { siteSeverity } from './severity.ts';
import type { TlsProbe } from './tls.ts';
import type { CheckResult, SiteConfig, SiteResult, Thresholds } from './types.ts';
import type { WordPressOrg } from './wporg.ts';

export interface Deps {
  http: HttpClient;
  tls: TlsProbe;
  wporg: WordPressOrg;
  now: () => Date;
}

export interface SiteOptions {
  thresholds: Thresholds;
  timeoutMs: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attempt(http: HttpClient, url: string, accept?: string): Promise<HttpResponse | { error: string }> {
  try {
    return await http.get(url, accept);
  } catch (error) {
    return { error: message(error) };
  }
}

async function probeTls(url: URL, deps: Deps, timeoutMs: number): Promise<TlsOutcome> {
  if (url.protocol !== 'https:') return { notHttps: true };
  try {
    const port = url.port ? Number(url.port) : 443;
    // URL keeps IPv6 hosts in brackets; the socket API wants them bare.
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    return { certificate: await deps.tls(host, port, timeoutMs) };
  } catch (error) {
    return { error: describeNetworkError(error) };
  }
}

/** Resolves a possibly relative discovery URL; `null` when missing or malformed. */
function resolveUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

async function fetchRest(http: HttpClient, root: string): Promise<RestOutcome> {
  const url = new URL(root);
  // The full index lists every route and can be hundreds of kilobytes.
  url.searchParams.set('_fields', 'name,namespaces');
  const response = await attempt(http, url.href, 'application/json');
  if ('error' in response) return response;
  return { status: response.status, namespaces: response.status === 200 ? restNamespaces(response.body) : null };
}

async function readInstalledPlugin(http: HttpClient, base: string, slug: string): Promise<InstalledOutcome> {
  const response = await attempt(http, new URL(`wp-content/plugins/${slug}/readme.txt`, base).href, 'text/plain');
  if ('error' in response) return { reason: `request failed: ${response.error}` };
  if (response.status !== 200) return { reason: `not publicly readable (HTTP ${response.status})` };
  if (response.headers.get('content-type')?.includes('text/html')) {
    return { reason: 'URL returned an HTML page' };
  }
  const stableTag = stableTagFromReadme(response.body);
  return stableTag ? { stableTag } : { reason: 'has no Stable tag' };
}

async function checkPlugin(base: string, slug: string, deps: Deps): Promise<CheckResult> {
  // WordPress.org is asked even when the readme is hidden: a closed plugin matters regardless.
  const [installed, lookup] = await Promise.all([readInstalledPlugin(deps.http, base, slug), deps.wporg.plugin(slug)]);
  return evaluatePlugin(slug, installed, lookup);
}

function skipped(site: SiteConfig, reason: string): CheckResult[] {
  return [
    { id: 'wordpress', status: 'skip', summary: '-', message: reason },
    { id: 'rest', status: 'skip', summary: '-', message: reason },
    ...site.plugins.map((slug): CheckResult => ({
      id: `plugin:${slug}`,
      status: 'skip',
      summary: '-',
      message: reason,
    })),
  ];
}

/** Runs every check for one site. Never rejects: failures become check results. */
export async function checkSite(site: SiteConfig, options: SiteOptions, deps: Deps): Promise<SiteResult> {
  const url = new URL(site.url);
  const [home, tls] = await Promise.all([
    attempt(deps.http, site.url, 'text/html'),
    probeTls(url, deps, options.timeoutMs),
  ]);

  const httpOutcome: HttpOutcome = 'error' in home ? home : { response: home };
  const checks: CheckResult[] = [
    evaluateHttp(httpOutcome, options.thresholds.responseTimeMs, site.url),
    evaluateTls(tls, options.thresholds.sslDays, deps.now()),
  ];

  if ('error' in home) {
    checks.push(...skipped(site, 'Skipped: home page unreachable.'));
  } else {
    checks.push(...(await wordpressChecks(site, home, deps)));
  }

  return { name: site.name, url: site.url, tags: site.tags, status: siteSeverity(checks), checks };
}

async function wordpressChecks(site: SiteConfig, home: HttpResponse, deps: Deps): Promise<CheckResult[]> {
  const metaVersion = versionFromGeneratorMeta(home.body);
  const advertisedRoot = resolveUrl(
    restRootFromLinkHeader(home.headers.get('link')) ?? restRootFromHtml(home.body),
    home.url,
  );
  const restRoot = advertisedRoot ?? new URL('wp-json/', site.url).href;

  const [rest, feed, plugins] = await Promise.all([
    fetchRest(deps.http, restRoot),
    // ?feed=rss2 works with and without pretty permalinks.
    metaVersion ? null : attempt(deps.http, new URL('?feed=rss2', site.url).href, 'application/rss+xml'),
    Promise.all(site.plugins.map((slug) => checkPlugin(site.url, slug, deps))),
  ]);

  const feedVersion = feed && !('error' in feed) && feed.status === 200 ? versionFromFeed(feed.body) : null;
  const signals: DetectionSignal[] = [];
  if (metaVersion) signals.push('generator-meta');
  if (advertisedRoot) signals.push('rest-link');
  if (feedVersion) signals.push('feed-generator');
  if ('namespaces' in rest && rest.namespaces?.includes('wp/v2')) signals.push('rest-namespace');
  const detection: Detection = { signals, version: metaVersion ?? feedVersion };

  let releases: ReleasesOutcome = { error: 'not requested' };
  if (detection.version) {
    try {
      releases = { releases: await deps.wporg.coreReleases() };
    } catch (error) {
      releases = { error: message(error) };
    }
  }
  return [evaluateWordPress(detection, releases), evaluateRest(rest), ...plugins];
}
