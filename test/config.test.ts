import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULTS, loadConfig, parseConfig, validateConfig } from '../src/config.ts';

function issuesOf(input: unknown): string[] {
  try {
    validateConfig(input);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('parseConfig', () => {
  it('applies defaults to a minimal config', () => {
    const config = parseConfig('sites:\n  - url: https://example.com\n');
    expect(config).toMatchObject({
      concurrency: DEFAULTS.concurrency,
      timeoutMs: DEFAULTS.timeoutMs,
      exitOn: 'fail',
      thresholds: { responseTimeMs: { warn: 2000, fail: 8000 }, sslDays: { warn: 21, fail: 7 } },
      slack: null,
    });
    expect(config.sites).toEqual([{ name: 'example.com', url: 'https://example.com/', tags: [], plugins: [] }]);
  });

  it('reads a full config', () => {
    const config = parseConfig(`
concurrency: 2
timeoutMs: 3000
exitOn: warn
userAgent: my-monitor/1.0
thresholds:
  responseTimeMs: { warn: 1000, fail: 3000 }
  sslDays: { warn: 30, fail: 10 }
notifications:
  slack:
    webhookUrlEnv: FLEET_SLACK
    notifyOn: fail
sites:
  - name: Blog
    url: https://example.com/blog
    tags: [client-a]
    plugins: [akismet, akismet, woocommerce]
`);
    expect(config).toMatchObject({
      concurrency: 2,
      timeoutMs: 3000,
      exitOn: 'warn',
      userAgent: 'my-monitor/1.0',
      thresholds: { responseTimeMs: { warn: 1000, fail: 3000 }, sslDays: { warn: 30, fail: 10 } },
      slack: { webhookUrlEnv: 'FLEET_SLACK', notifyOn: 'fail' },
    });
    // Sub-directory installs get a trailing slash so wp-json/ resolves beneath them.
    expect(config.sites[0]).toEqual({
      name: 'Blog',
      url: 'https://example.com/blog/',
      tags: ['client-a'],
      plugins: ['akismet', 'woocommerce'],
    });
  });

  it('uses Slack defaults when the section is empty', () => {
    const config = parseConfig('notifications:\n  slack: {}\nsites:\n  - url: https://example.com\n');
    expect(config.slack).toEqual({ webhookUrlEnv: 'SLACK_WEBHOOK_URL', notifyOn: 'warn' });
  });

  it('reports YAML syntax errors as ConfigError', () => {
    expect(() => parseConfig('sites: [')).toThrow(ConfigError);
  });
});

describe('validateConfig errors', () => {
  it('requires a mapping', () => {
    expect(issuesOf(null)).toEqual(['config: must be a mapping with a sites list']);
    expect(issuesOf(['https://example.com'])).toEqual(['config: must be a mapping with a sites list']);
  });

  it('requires a non-empty sites list', () => {
    expect(issuesOf({})).toEqual(['sites: must be a non-empty list']);
    expect(issuesOf({ sites: [] })).toEqual(['sites: must be a non-empty list']);
  });

  it('collects every problem with its path', () => {
    const issues = issuesOf({
      concurrency: 0,
      timeoutMs: 'fast',
      exitOn: 'always',
      colour: true,
      thresholds: { responseTimeMs: { warn: 5000, fail: 1000 }, sslDays: { warn: 3, fail: 10 } },
      notifications: { slack: { webhookUrlEnv: 'https://hooks.slack.com/services/x', notifyOn: 'ok' } },
      sites: [
        { url: 'ftp://example.com' },
        { name: 'No URL' },
        { url: 'not a url' },
        { url: 'https://example.org', plugins: ['Akismet', 'ok-slug'], tags: 'a', extra: 1 },
        'https://example.net',
      ],
    });
    expect(issues).toEqual([
      'colour: unknown key',
      'concurrency: must be an integer >= 1',
      'timeoutMs: must be an integer >= 1',
      'exitOn: must be one of warn, fail, never',
      'thresholds.responseTimeMs: warn must not be greater than fail',
      'thresholds.sslDays: warn must not be smaller than fail',
      'notifications.slack.webhookUrlEnv: must be an environment variable name (the URL itself is a secret)',
      'notifications.slack.notifyOn: must be one of warn, fail',
      'sites[0].url: must start with https:// or http://',
      'sites[1].url: is required',
      'sites[2].url: is not a valid URL: not a url',
      'sites[3].extra: unknown key',
      'sites[3].plugins[0]: "Akismet" is not a WordPress.org plugin slug',
      'sites[3].tags: must be a list of non-empty strings',
      'sites[4]: must be a mapping with at least a url',
    ]);
  });

  it('rejects duplicate sites after normalisation', () => {
    expect(issuesOf({ sites: [{ url: 'https://example.com' }, { url: 'https://example.com/' }] })).toEqual([
      'sites: duplicate url https://example.com/',
    ]);
  });

  it('lists issues in the error message', () => {
    expect(() => validateConfig({ sites: [] })).toThrow('Invalid config:\n  - sites: must be a non-empty list');
  });
});

describe('loadConfig', () => {
  it('reports a missing file', async () => {
    await expect(loadConfig('/definitely/not/here/fleet.yml')).rejects.toMatchObject({
      issues: ['file not found'],
      message: 'Cannot read /definitely/not/here/fleet.yml:\n  - file not found',
    });
  });

  it('names the file when the config is invalid', async () => {
    await expect(loadConfig(new URL('../package.json', import.meta.url).pathname)).rejects.toThrow(
      /^Invalid config in .*package\.json:\n {2}- name: unknown key/,
    );
  });

  it('loads the example config', async () => {
    const config = await loadConfig(new URL('../examples/fleet.yml', import.meta.url).pathname);
    expect(config.sites.length).toBeGreaterThan(0);
  });
});
