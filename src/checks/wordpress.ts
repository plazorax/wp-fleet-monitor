import type { CheckResult } from '../types.ts';
import { branchOf, compareVersions, parseVersion } from '../version.ts';
import type { CoreReleases } from '../wporg.ts';

export type DetectionSignal = 'generator-meta' | 'rest-link' | 'feed-generator' | 'rest-namespace';

export interface Detection {
  /** Which public fingerprints were found; empty means "not WordPress, or fully hidden". */
  signals: DetectionSignal[];
  /** From the generator tag, else the feed generator. */
  version: string | null;
}

export type ReleasesOutcome = { releases: CoreReleases } | { error: string };

/**
 * WordPress detection and core version.
 * - no WordPress signal at all -> warn
 * - version hidden, unparsable, or latest release unavailable -> unknown
 * - same as or newer than the latest release -> ok
 * - on an older branch but at that branch's newest security release -> warn
 * - behind the newest release of its own branch, or on a branch that no
 *   longer gets updates -> fail
 */
export function evaluateWordPress(detection: Detection, outcome: ReleasesOutcome): CheckResult {
  const id = 'wordpress';
  if (detection.signals.length === 0) {
    return {
      id,
      status: 'warn',
      summary: 'not detected',
      message: 'WordPress not detected (no generator tag, REST API link, feed generator or wp/v2 namespace).',
    };
  }
  if (detection.version === null) {
    return {
      id,
      status: 'unknown',
      summary: 'hidden',
      message: `WordPress detected (${detection.signals.join(', ')}) but the core version is not public.`,
    };
  }
  const version = parseVersion(detection.version);
  if (!version) {
    return {
      id,
      status: 'unknown',
      summary: detection.version,
      message: `Cannot parse core version "${detection.version}".`,
    };
  }
  if ('error' in outcome) {
    return {
      id,
      status: 'unknown',
      summary: version.raw,
      message: `Core ${version.raw}; latest release unavailable: ${outcome.error}`,
    };
  }

  const { latest, branches } = outcome.releases;
  if (compareVersions(version, latest) >= 0) {
    const ahead = compareVersions(version, latest) > 0 ? ` (ahead of latest release ${latest.raw})` : '';
    return { id, status: 'ok', summary: version.raw, message: `Core ${version.raw} is up to date${ahead}.` };
  }

  const summary = `${version.raw} < ${latest.raw}`;
  const branch = branchOf(version);
  const branchLatest = branches.get(branch);
  if (!branchLatest) {
    return {
      id,
      status: 'fail',
      summary,
      message: `Core ${version.raw}: branch ${branch} no longer receives security releases; latest is ${latest.raw}.`,
    };
  }
  if (compareVersions(version, branchLatest) < 0) {
    return {
      id,
      status: 'fail',
      summary,
      message: `Core ${version.raw} is missing ${branchLatest.raw}, the newest ${branch}.x release; latest is ${latest.raw}.`,
    };
  }
  return {
    id,
    status: 'warn',
    summary,
    message: `Core ${version.raw} is the newest ${branch}.x release but ${latest.raw} is available.`,
  };
}
