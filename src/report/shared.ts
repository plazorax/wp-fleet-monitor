import type { CheckResult, SiteResult } from '../types.ts';

export const COLUMNS = ['http', 'tls', 'wordpress', 'rest'] as const;

/** Compact cell text: `ok`, `warn`, `fail` prefix plus the check summary. */
export function cell(check: CheckResult | undefined): string {
  if (!check) return '-';
  if (check.status === 'skip') return 'skip';
  return check.status === 'ok' ? check.summary : `${check.status.toUpperCase()} ${check.summary}`;
}

export function pluginCell(site: SiteResult): string {
  const plugins = site.checks.filter((check) => check.id.startsWith('plugin:'));
  if (plugins.length === 0) return '-';
  const counts = new Map<string, number>();
  for (const check of plugins) counts.set(check.status, (counts.get(check.status) ?? 0) + 1);
  return ['fail', 'warn', 'unknown', 'skip', 'ok']
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status) ?? 0} ${status}`)
    .join(', ');
}

export function findCheck(site: SiteResult, id: string): CheckResult | undefined {
  return site.checks.find((check) => check.id === id);
}

/** Checks worth listing under a site: anything that is not ok or skipped. */
export function problems(site: SiteResult): CheckResult[] {
  return site.checks.filter((check) => check.status !== 'ok' && check.status !== 'skip');
}

export function sites(count: number): string {
  return `${count} ${count === 1 ? 'site' : 'sites'}`;
}
