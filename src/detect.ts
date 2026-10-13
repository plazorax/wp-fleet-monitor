/**
 * WordPress fingerprinting from public responses. All of these signals can be removed or
 * altered by a site owner, so absence proves nothing; see docs/checks.md.
 */

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const WP_VERSION = /^WordPress\s+(\d[\w.-]*)/i;

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (name) result.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

/** Version from `<meta name="generator" content="WordPress 6.9.10">`, in any attribute order. */
export function versionFromGeneratorMeta(html: string): string | null {
  for (const [tag] of html.matchAll(META_TAG)) {
    const attrs = attributes(tag);
    if (attrs.get('name')?.toLowerCase() !== 'generator') continue;
    const match = WP_VERSION.exec(attrs.get('content')?.trim() ?? '');
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Version from an RSS/Atom feed: `<generator>https://wordpress.org/?v=6.9.10</generator>`. */
export function versionFromFeed(xml: string): string | null {
  const match = /<generator\b[^>]*>\s*https?:\/\/wordpress\.org\/\?v=([^<\s]+)\s*<\/generator>/i.exec(xml);
  if (match?.[1]) return match[1];
  // Atom feeds: <generator uri="https://wordpress.org/" version="6.9.10">WordPress</generator>
  const atom = /<generator\b[^>]*\bversion="([^"]+)"[^>]*>\s*WordPress\s*<\/generator>/i.exec(xml);
  return atom?.[1] ?? null;
}

/** REST API root from `Link: <https://example.com/wp-json/>; rel="https://api.w.org/"`. */
export function restRootFromLinkHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(/,(?=\s*<)/)) {
    const match = /<([^>]+)>\s*;(.*)$/.exec(part.trim());
    if (match?.[1] && /rel\s*=\s*"?https:\/\/api\.w\.org\/"?/i.test(match[2] ?? '')) return match[1];
  }
  return null;
}

/** Same discovery link as an HTML element: `<link rel="https://api.w.org/" href="...">`. */
export function restRootFromHtml(html: string): string | null {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    if (attrs.get('rel') === 'https://api.w.org/' && attrs.get('href')) return attrs.get('href') ?? null;
  }
  return null;
}

/** Namespaces from a REST API index document, or `null` when it is not one. */
export function restNamespaces(body: string): string[] | null {
  try {
    const data = JSON.parse(body) as { namespaces?: unknown } | null;
    const namespaces = data?.namespaces;
    if (Array.isArray(namespaces) && namespaces.every((item) => typeof item === 'string')) {
      return namespaces;
    }
  } catch {
    // Not JSON: often an HTML error page from a firewall or cache.
  }
  return null;
}

/** Stable tag from a plugin readme.txt, or `null` when the body is not a readme. */
export function stableTagFromReadme(body: string): string | null {
  const match = /^[ \t]*Stable tag:[ \t]*(\S+)/im.exec(body);
  return match?.[1] ?? null;
}
