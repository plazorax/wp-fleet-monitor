/** Severity of a site or of the whole run. */
export type Severity = 'ok' | 'warn' | 'fail';

/**
 * Outcome of a single check. `unknown` means the check ran but could not reach a
 * verdict (for example the version is hidden); `skip` means it did not run.
 * Neither affects the site severity.
 */
export type CheckStatus = Severity | 'unknown' | 'skip';

export interface CheckResult {
  /** `http`, `tls`, `wordpress`, `rest` or `plugin:<slug>`. */
  id: string;
  status: CheckStatus;
  /** Short value for table cells, e.g. `200 412 ms` or `54 days`. */
  summary: string;
  /** One-sentence explanation, shown for anything that is not `ok`. */
  message: string;
}

export interface SiteConfig {
  name: string;
  url: string;
  tags: string[];
  plugins: string[];
}

export interface Range {
  warn: number;
  fail: number;
}

export interface Thresholds {
  /** Home page fetch time in milliseconds; at or above `warn`/`fail`. */
  responseTimeMs: Range;
  /** Days until certificate expiry; at or below `warn`/`fail`. */
  sslDays: Range;
}

export interface SlackSettings {
  /** Name of the environment variable holding the webhook URL. */
  webhookUrlEnv: string;
  /** Lowest run severity that triggers a message. */
  notifyOn: Exclude<Severity, 'ok'>;
}

export interface FleetConfig {
  concurrency: number;
  timeoutMs: number;
  userAgent: string;
  /** Lowest run severity that makes the CLI exit with code 1. */
  exitOn: Exclude<Severity, 'ok'> | 'never';
  thresholds: Thresholds;
  slack: SlackSettings | null;
  sites: SiteConfig[];
}

export interface SiteResult {
  name: string;
  url: string;
  tags: string[];
  status: Severity;
  checks: CheckResult[];
}

export interface FleetReport {
  generatedAt: string;
  status: Severity;
  summary: Record<Severity, number> & { total: number };
  sites: SiteResult[];
}
