/**
 * Version parsing for WordPress core (`6.9.10`, `7.1`, `7.2-alpha-64319`, `6.5-RC1`) and
 * WordPress.org plugins (`5.7.2`, `2.3.4.1`, `v1.2`). Anything else, such as `trunk`,
 * is treated as unparsable rather than guessed at.
 */
export interface Version {
  /** Numeric components, e.g. `[7, 2]` for `7.2-alpha-64319`. */
  parts: number[];
  /** Pre-release label without the separator, e.g. `alpha-64319`, or `null`. */
  pre: string | null;
  raw: string;
}

const VERSION_PATTERN = /^v?(\d+(?:\.\d+)*)(?:[-_]?([a-z][0-9a-z.-]*))?$/i;

export function parseVersion(input: string): Version | null {
  const raw = input.trim();
  const match = VERSION_PATTERN.exec(raw);
  if (!match?.[1]) return null;
  return {
    parts: match[1].split('.').map(Number),
    pre: match[2] ?? null,
    raw,
  };
}

const PRE_ORDER = ['alpha', 'beta', 'rc'];

function preRank(label: string): number {
  const lower = label.toLowerCase();
  const index = PRE_ORDER.findIndex((name) => lower.startsWith(name));
  return index === -1 ? PRE_ORDER.length : index;
}

function comparePre(a: string | null, b: string | null): number {
  if (a === b) return 0;
  // A release sorts after any pre-release of the same numbers.
  if (a === null) return 1;
  if (b === null) return -1;
  const rank = preRank(a) - preRank(b);
  if (rank !== 0) return Math.sign(rank);
  const numberA = Number(/\d+/.exec(a)?.[0] ?? 0);
  const numberB = Number(/\d+/.exec(b)?.[0] ?? 0);
  return Math.sign(numberA - numberB);
}

/** Returns -1, 0 or 1. Missing components count as zero, so `7.1` equals `7.1.0`. */
export function compareVersions(a: Version, b: Version): number {
  const length = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < length; i++) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return comparePre(a.pre, b.pre);
}

/** WordPress release branch, e.g. `6.9` for `6.9.10`. */
export function branchOf(version: Version): string {
  return `${version.parts[0] ?? 0}.${version.parts[1] ?? 0}`;
}
