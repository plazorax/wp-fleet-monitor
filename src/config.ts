import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { FleetConfig, Range, SiteConfig, SlackSettings, Thresholds } from './types.ts';
import { VERSION } from './version-info.ts';

export const DEFAULT_USER_AGENT = `wp-fleet-monitor/${VERSION} (+https://github.com/plazorax/wp-fleet-monitor)`;

export const DEFAULTS = {
  concurrency: 4,
  timeoutMs: 15_000,
  exitOn: 'fail',
  responseTimeMs: { warn: 2_000, fail: 8_000 },
  sslDays: { warn: 21, fail: 7 },
  webhookUrlEnv: 'SLACK_WEBHOOK_URL',
  notifyOn: 'warn',
} as const;

/** Thrown when the config cannot be used; `issues` lists every problem found. */
export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[], heading = 'Invalid config') {
    super(`${heading}:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TOP_LEVEL_KEYS = new Set([
  'concurrency',
  'timeoutMs',
  'userAgent',
  'exitOn',
  'thresholds',
  'notifications',
  'sites',
]);
const SITE_KEYS = new Set(['url', 'name', 'tags', 'plugins']);

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects issues instead of stopping at the first one, so users can fix everything at once. */
class Validator {
  readonly issues: string[] = [];

  add(path: string, problem: string): void {
    this.issues.push(`${path}: ${problem}`);
  }

  unknownKeys(value: Obj, allowed: Set<string>, path: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) this.add(path ? `${path}.${key}` : key, 'unknown key');
    }
  }

  integer(value: unknown, path: string, fallback: number, min: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      this.add(path, `must be an integer >= ${min}`);
      return fallback;
    }
    return value;
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[], fallback: T): T {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
      this.add(path, `must be one of ${options.join(', ')}`);
      return fallback;
    }
    return value as T;
  }

  stringList(value: unknown, path: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item !== '')) {
      this.add(path, 'must be a list of non-empty strings');
      return [];
    }
    return value as string[];
  }

  range(value: unknown, path: string, fallback: Range, direction: 'ascending' | 'descending'): Range {
    if (value === undefined) return { ...fallback };
    if (!isObject(value)) {
      this.add(path, 'must be a mapping with warn and fail');
      return { ...fallback };
    }
    this.unknownKeys(value, new Set(['warn', 'fail']), path);
    const warn = this.integer(value.warn, `${path}.warn`, fallback.warn, 0);
    const fail = this.integer(value.fail, `${path}.fail`, fallback.fail, 0);
    if (direction === 'ascending' && warn > fail) this.add(path, 'warn must not be greater than fail');
    if (direction === 'descending' && warn < fail) this.add(path, 'warn must not be smaller than fail');
    return { warn, fail };
  }
}

function parseSite(value: unknown, index: number, v: Validator): SiteConfig | null {
  const path = `sites[${index}]`;
  if (!isObject(value)) {
    v.add(path, 'must be a mapping with at least a url');
    return null;
  }
  v.unknownKeys(value, SITE_KEYS, path);

  let url: URL | null = null;
  if (typeof value.url !== 'string') {
    v.add(`${path}.url`, 'is required');
  } else {
    try {
      url = new URL(value.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        v.add(`${path}.url`, 'must start with https:// or http://');
        url = null;
      }
    } catch {
      v.add(`${path}.url`, `is not a valid URL: ${value.url}`);
    }
  }

  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.trim() === '')) {
    v.add(`${path}.name`, 'must be a non-empty string');
  }
  const plugins = v.stringList(value.plugins, `${path}.plugins`);
  plugins.forEach((slug, i) => {
    if (!SLUG_PATTERN.test(slug)) {
      v.add(`${path}.plugins[${i}]`, `"${slug}" is not a WordPress.org plugin slug`);
    }
  });
  const tags = v.stringList(value.tags, `${path}.tags`);

  if (!url) return null;
  // Normalise to a directory URL so relative paths like `wp-json/` resolve under it.
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  url.hash = '';
  return {
    url: url.href,
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : url.host,
    tags,
    plugins: [...new Set(plugins)],
  };
}

function parseSlack(value: unknown, v: Validator): SlackSettings | null {
  if (value === undefined || value === null || value === false) return null;
  const path = 'notifications.slack';
  if (!isObject(value)) {
    v.add(path, 'must be a mapping');
    return null;
  }
  v.unknownKeys(value, new Set(['webhookUrlEnv', 'notifyOn']), path);
  let webhookUrlEnv: string = DEFAULTS.webhookUrlEnv;
  if (value.webhookUrlEnv !== undefined) {
    if (typeof value.webhookUrlEnv === 'string' && ENV_NAME_PATTERN.test(value.webhookUrlEnv)) {
      webhookUrlEnv = value.webhookUrlEnv;
    } else {
      v.add(`${path}.webhookUrlEnv`, 'must be an environment variable name (the URL itself is a secret)');
    }
  }
  const notifyOn = v.oneOf(value.notifyOn, `${path}.notifyOn`, ['warn', 'fail'], DEFAULTS.notifyOn);
  return { webhookUrlEnv, notifyOn };
}

/** Validates an already-parsed YAML/JSON document and applies defaults. */
export function validateConfig(input: unknown): FleetConfig {
  const v = new Validator();
  if (!isObject(input)) throw new ConfigError(['config: must be a mapping with a sites list']);
  v.unknownKeys(input, TOP_LEVEL_KEYS, '');

  const concurrency = v.integer(input.concurrency, 'concurrency', DEFAULTS.concurrency, 1);
  const timeoutMs = v.integer(input.timeoutMs, 'timeoutMs', DEFAULTS.timeoutMs, 1);
  const exitOn = v.oneOf(input.exitOn, 'exitOn', ['warn', 'fail', 'never'], DEFAULTS.exitOn);

  let userAgent = DEFAULT_USER_AGENT;
  if (input.userAgent !== undefined) {
    if (typeof input.userAgent === 'string' && input.userAgent.trim() !== '') userAgent = input.userAgent;
    else v.add('userAgent', 'must be a non-empty string');
  }

  const thresholdsInput = input.thresholds ?? {};
  let thresholds: Thresholds = { responseTimeMs: { ...DEFAULTS.responseTimeMs }, sslDays: { ...DEFAULTS.sslDays } };
  if (isObject(thresholdsInput)) {
    v.unknownKeys(thresholdsInput, new Set(['responseTimeMs', 'sslDays']), 'thresholds');
    thresholds = {
      responseTimeMs: v.range(
        thresholdsInput.responseTimeMs,
        'thresholds.responseTimeMs',
        DEFAULTS.responseTimeMs,
        'ascending',
      ),
      sslDays: v.range(thresholdsInput.sslDays, 'thresholds.sslDays', DEFAULTS.sslDays, 'descending'),
    };
  } else {
    v.add('thresholds', 'must be a mapping');
  }

  let slack: SlackSettings | null = null;
  const notifications = input.notifications;
  if (notifications !== undefined && notifications !== null) {
    if (isObject(notifications)) {
      v.unknownKeys(notifications, new Set(['slack']), 'notifications');
      slack = parseSlack(notifications.slack, v);
    } else {
      v.add('notifications', 'must be a mapping');
    }
  }

  const sites: SiteConfig[] = [];
  if (!Array.isArray(input.sites) || input.sites.length === 0) {
    v.add('sites', 'must be a non-empty list');
  } else {
    input.sites.forEach((entry, index) => {
      const site = parseSite(entry, index, v);
      if (site) sites.push(site);
    });
    const seen = new Set<string>();
    for (const site of sites) {
      if (seen.has(site.url)) v.add('sites', `duplicate url ${site.url}`);
      seen.add(site.url);
    }
  }

  if (v.issues.length > 0) throw new ConfigError(v.issues);
  return { concurrency, timeoutMs, userAgent, exitOn, thresholds, slack, sites };
}

export function parseConfig(text: string): FleetConfig {
  let document: unknown;
  try {
    document = parse(text);
  } catch (error) {
    throw new ConfigError([`yaml: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return validateConfig(document);
}

/** Reads and validates a config file; error messages name the file. */
export async function loadConfig(path: string): Promise<FleetConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason = code === 'ENOENT' ? 'file not found' : error instanceof Error ? error.message : String(error);
    throw new ConfigError([reason], `Cannot read ${path}`);
  }
  try {
    return parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) throw new ConfigError(error.issues, `Invalid config in ${path}`);
    throw error;
  }
}
