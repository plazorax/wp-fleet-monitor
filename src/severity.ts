import type { CheckResult, CheckStatus, Severity } from './types.ts';

const RANK: Record<Severity, number> = { ok: 0, warn: 1, fail: 2 };

export function isSeverity(status: CheckStatus): status is Severity {
  return status === 'ok' || status === 'warn' || status === 'fail';
}

/** The most severe of the given values; `unknown` and `skip` are ignored. */
export function worst(statuses: Iterable<CheckStatus>): Severity {
  let result: Severity = 'ok';
  for (const status of statuses) {
    if (isSeverity(status) && RANK[status] > RANK[result]) result = status;
  }
  return result;
}

export function siteSeverity(checks: readonly CheckResult[]): Severity {
  return worst(checks.map((check) => check.status));
}

/** True when `status` is at least as severe as `threshold`. */
export function atLeast(status: Severity, threshold: Severity): boolean {
  return RANK[status] >= RANK[threshold];
}
