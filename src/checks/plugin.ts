import type { CheckResult } from '../types.ts';
import { compareVersions, parseVersion } from '../version.ts';
import type { PluginLookup } from '../wporg.ts';

/** Stable tag from the public readme.txt, or why it could not be read (completes "readme.txt ..."). */
export type InstalledOutcome = { stableTag: string } | { reason: string };

/**
 * A configured plugin, from its public readme.txt "Stable tag" and WordPress.org.
 * - closed on WordPress.org for a security issue -> fail; closed for another reason -> warn
 * - readme not readable, tag not a version, or plugin not on WordPress.org -> unknown
 * - older than WordPress.org -> warn (an outdated plugin is not necessarily vulnerable)
 * - same or newer -> ok
 */
export function evaluatePlugin(slug: string, installed: InstalledOutcome, lookup: PluginLookup): CheckResult {
  const id = `plugin:${slug}`;

  if (lookup.status === 'closed') {
    const why = lookup.reasonText ?? lookup.reason ?? 'no reason given';
    const since = lookup.date ? ` since ${lookup.date}` : '';
    return {
      id,
      status: lookup.reason === 'security-issue' ? 'fail' : 'warn',
      summary: 'closed',
      message: `Closed on WordPress.org${since} (${why}); it gets no updates.`,
    };
  }
  if ('reason' in installed) {
    return { id, status: 'unknown', summary: '?', message: `readme.txt ${installed.reason}.` };
  }
  const version = parseVersion(installed.stableTag);
  if (!version) {
    const tag = installed.stableTag;
    return { id, status: 'unknown', summary: tag, message: `readme.txt Stable tag "${tag}" is not a version.` };
  }
  if (lookup.status === 'unavailable') {
    return { id, status: 'unknown', summary: version.raw, message: `Installed ${version.raw}; ${lookup.reason}.` };
  }
  if (compareVersions(version, lookup.version) < 0) {
    return {
      id,
      status: 'warn',
      summary: `${version.raw} < ${lookup.version.raw}`,
      message: `Installed ${version.raw} is behind ${lookup.version.raw} on WordPress.org.`,
    };
  }
  return { id, status: 'ok', summary: version.raw, message: `Installed ${version.raw} is up to date.` };
}
