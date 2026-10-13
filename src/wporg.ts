import type { HttpClient } from './http.ts';
import { branchOf, compareVersions, parseVersion, type Version } from './version.ts';

export const CORE_VERSION_URL = 'https://api.wordpress.org/core/version-check/1.7/';
export const PLUGIN_INFO_URL = 'https://api.wordpress.org/plugins/info/1.2/';

export interface CoreReleases {
  latest: Version;
  /** Newest release per branch, e.g. `6.9` -> `6.9.10`. */
  branches: Map<string, Version>;
}

export type PluginLookup =
  | { status: 'found'; version: Version }
  /** Closed on WordPress.org; `reason` is a code such as `security-issue` or `author-request`. */
  | { status: 'closed'; date: string | null; reason: string | null; reasonText: string | null }
  | { status: 'unavailable'; reason: string };

export interface WordPressOrg {
  coreReleases(): Promise<CoreReleases>;
  plugin(slug: string): Promise<PluginLookup>;
}

/**
 * Parses the `offers` array of version-check/1.7. Without a `version` query parameter the
 * first offer is the newest release; the remaining `autoupdate` offers list the newest
 * release of each older branch that still gets security fixes.
 */
export function parseCoreReleases(json: unknown): CoreReleases {
  const offers = (json as { offers?: unknown } | null)?.offers;
  if (!Array.isArray(offers)) throw new Error('version-check response has no offers');
  const branches = new Map<string, Version>();
  let latest: Version | null = null;
  for (const offer of offers as unknown[]) {
    const current = (offer as { current?: unknown } | null)?.current;
    const version = typeof current === 'string' ? parseVersion(current) : null;
    if (!version) continue;
    if (!latest || compareVersions(version, latest) > 0) latest = version;
    const branch = branchOf(version);
    const known = branches.get(branch);
    if (!known || compareVersions(version, known) > 0) branches.set(branch, version);
  }
  if (!latest) throw new Error('version-check response has no usable versions');
  return { latest, branches };
}

/** Large plugin_information fields we never read; turning them off shrinks the response. */
const UNUSED_PLUGIN_FIELDS = ['sections', 'versions', 'reviews', 'screenshots', 'banners', 'icons', 'contributors'];

export function pluginInfoUrl(slug: string): string {
  const url = new URL(PLUGIN_INFO_URL);
  url.searchParams.set('action', 'plugin_information');
  url.searchParams.set('request[slug]', slug);
  for (const field of UNUSED_PLUGIN_FIELDS) url.searchParams.set(`request[fields][${field}]`, '0');
  return url.href;
}

/** WordPress.org API client; each lookup runs at most once per process. */
export function createWordPressOrg(http: HttpClient): WordPressOrg {
  let core: Promise<CoreReleases> | null = null;
  const plugins = new Map<string, Promise<PluginLookup>>();

  async function lookupPlugin(slug: string): Promise<PluginLookup> {
    const response = await http.get(pluginInfoUrl(slug), 'application/json');
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      // Handled below through the status code.
    }
    const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
    // Closed plugins answer 404 with {"error":"closed","closed_date":...,"reason":"security-issue",...}.
    if (data.error === 'closed' || data.closed === true) {
      return {
        status: 'closed',
        date: text(data.closed_date),
        reason: text(data.reason),
        reasonText: text(data.reason_text),
      };
    }
    if (response.status === 404) return { status: 'unavailable', reason: 'not found on WordPress.org' };
    if (response.status !== 200) {
      return { status: 'unavailable', reason: `WordPress.org API returned HTTP ${response.status}` };
    }
    const version = typeof data.version === 'string' ? parseVersion(data.version) : null;
    if (!version) return { status: 'unavailable', reason: 'WordPress.org did not return a comparable version' };
    return { status: 'found', version };
  }

  return {
    coreReleases() {
      core ??= http.get(CORE_VERSION_URL, 'application/json').then((response) => {
        if (response.status !== 200) throw new Error(`version-check returned HTTP ${response.status}`);
        return parseCoreReleases(JSON.parse(response.body));
      });
      return core;
    },
    plugin(slug) {
      let lookup = plugins.get(slug);
      if (!lookup) {
        lookup = lookupPlugin(slug).catch((error: unknown): PluginLookup => ({
          status: 'unavailable',
          reason: `WordPress.org lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        }));
        plugins.set(slug, lookup);
      }
      return lookup;
    },
  };
}
