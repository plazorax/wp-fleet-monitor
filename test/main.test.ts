import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../src/http.ts';
import { main, type Io } from '../src/main.ts';
import { pluginInfoUrl } from '../src/wporg.ts';
import { NOW, coreRoute, html, json, mockFetch, mockTls, text } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'wp-fleet-monitor-'));

function configFile(yaml: string): string {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.yml`);
  writeFileSync(path, yaml);
  return path;
}

const HEALTHY_ROUTES = {
  'https://ok.example/': html('<meta name="generator" content="WordPress 7.1.3">'),
  'https://ok.example/wp-json/?_fields=name%2Cnamespaces': json({ namespaces: ['wp/v2'] }),
  ...coreRoute,
};
const OUTDATED_ROUTES = {
  'https://old.example/': html('<meta name="generator" content="WordPress 7.0.7">'),
  'https://old.example/wp-json/?_fields=name%2Cnamespaces': json({ namespaces: ['wp/v2'] }),
  'https://old.example/wp-content/plugins/akismet/readme.txt': text('Stable tag: 5.7.2'),
  [pluginInfoUrl('akismet')]: json({ version: '5.7.2' }),
};

function io(fetch: FetchFn, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const value: Io = {
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    env,
    fetch,
    tls: mockTls(),
    now: () => NOW.getTime(),
    writeFile: (path, content) => {
      files.set(path, content);
      return Promise.resolve();
    },
  };
  return { io: value, stdout: () => out.join(''), stderr: () => err.join(''), files };
}

const TWO_SITES = `
notifications:
  slack: { notifyOn: warn }
sites:
  - url: https://ok.example
    tags: [prod]
  - url: https://old.example
    plugins: [akismet]
    tags: [staging]
`;

describe('main', () => {
  it('prints help and the version', async () => {
    const help = io(mockFetch({}).fetch);
    expect(await main(['--help'], help.io)).toBe(0);
    expect(help.stdout()).toContain('Usage: wp-fleet-monitor');
    const version = io(mockFetch({}).fetch);
    expect(await main(['-v'], version.io)).toBe(0);
    expect(version.stdout()).toBe('0.1.0\n');
  });

  it('exits 2 on bad arguments and invalid config', async () => {
    const bad = io(mockFetch({}).fetch);
    expect(await main(['--exit-on', 'sometimes'], bad.io)).toBe(2);
    expect(bad.stderr()).toContain('--exit-on must be warn, fail or never');
    expect(await main(['--unknown'], io(mockFetch({}).fetch).io)).toBe(2);

    const invalid = io(mockFetch({}).fetch);
    expect(await main(['-c', configFile('sites: []')], invalid.io)).toBe(2);
    expect(invalid.stderr()).toContain('sites: must be a non-empty list');
  });

  it('prints the table, writes Markdown and sends Slack on warn', async () => {
    const { fetch, calls } = mockFetch({
      ...HEALTHY_ROUTES,
      ...OUTDATED_ROUTES,
      'https://hooks.slack.test/x': text('ok'),
    });
    const run = io(fetch, {
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '42',
    });
    const code = await main(
      ['-c', configFile(TWO_SITES), '--markdown', 'summary.md', '--json-file', 'report.json'],
      run.io,
    );

    expect(code).toBe(0); // worst is warn and exitOn defaults to fail
    expect(run.stdout()).toContain('2 sites: 1 ok, 1 warn, 0 fail');
    expect(run.stderr()).toContain('[2/2]');
    expect(run.stderr()).toContain('Slack: notification sent.');
    expect(run.files.get('summary.md')).toContain('## ⚠️ WordPress fleet: WARN');
    expect(JSON.parse(run.files.get('report.json') ?? '{}')).toMatchObject({ status: 'warn', summary: { total: 2 } });
    expect(calls).toContain('https://hooks.slack.test/x');
    const slackCall = fetch.mock.calls.find(([url]) => url === 'https://hooks.slack.test/x');
    expect(slackCall?.[1]?.body).toContain('actions/runs/42|Full report');
  });

  it('honours --exit-on, --tag, --json and --no-slack', async () => {
    const { fetch, calls } = mockFetch({ ...HEALTHY_ROUTES, ...OUTDATED_ROUTES });
    const run = io(fetch, { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' });
    const code = await main(
      ['-c', configFile(TWO_SITES), '--tag', 'staging', '--json', '--exit-on', 'warn', '--no-slack'],
      run.io,
    );

    expect(code).toBe(1);
    const report = JSON.parse(run.stdout()) as { status: string; sites: { url: string }[] };
    expect(report.status).toBe('warn');
    expect(report.sites.map((site) => site.url)).toEqual(['https://old.example/']);
    expect(calls).not.toContain('https://ok.example/');
    expect(calls).not.toContain('https://hooks.slack.test/x');
  });

  it('exits 2 when no site matches the tag', async () => {
    const run = io(mockFetch({}).fetch);
    expect(await main(['-c', configFile(TWO_SITES), '--tag', 'nope'], run.io)).toBe(2);
    expect(run.stderr()).toContain('No sites match --tag nope');
  });

  it('skips Slack without a webhook and fails the run when sending fails', async () => {
    const missing = io(mockFetch({ ...HEALTHY_ROUTES, ...OUTDATED_ROUTES }).fetch);
    expect(await main(['-c', configFile(TWO_SITES)], missing.io)).toBe(0);
    expect(missing.stderr()).toContain('SLACK_WEBHOOK_URL is not set');

    const broken = io(
      mockFetch({ ...HEALTHY_ROUTES, ...OUTDATED_ROUTES, 'https://hooks.slack.test/x': text('no_service', 404) }).fetch,
      { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' },
    );
    expect(await main(['-c', configFile(TWO_SITES)], broken.io)).toBe(1);
    expect(broken.stderr()).toContain('Slack: notification failed: Slack webhook returned HTTP 404: no_service');
  });

  it('does not notify Slack when everything is ok', async () => {
    const { fetch, calls } = mockFetch(HEALTHY_ROUTES);
    const run = io(fetch, { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' });
    expect(await main(['-c', configFile(TWO_SITES), '--tag', 'prod'], run.io)).toBe(0);
    expect(calls).not.toContain('https://hooks.slack.test/x');
  });
});
