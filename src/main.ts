import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from './config.ts';
import { createHttpClient, type FetchFn } from './http.ts';
import { renderConsole } from './report/console.ts';
import { renderJson } from './report/json.ts';
import { renderMarkdown } from './report/markdown.ts';
import { runFleet } from './run.ts';
import { atLeast } from './severity.ts';
import { buildSlackPayload, sendSlack, shouldNotify } from './slack.ts';
import { probeCertificate, type TlsProbe } from './tls.ts';
import type { FleetConfig, FleetReport, SiteResult } from './types.ts';
import { VERSION } from './version-info.ts';
import { createWordPressOrg } from './wporg.ts';

export const USAGE = `Usage: wp-fleet-monitor [options]

Checks a fleet of WordPress sites and reports problems.

Options:
  -c, --config <file>      Fleet config (default: fleet.yml)
      --json               Print the report as JSON instead of a table
      --json-file <file>   Also write the JSON report to a file
      --markdown <file>    Also write a Markdown report (e.g. "$GITHUB_STEP_SUMMARY")
      --tag <tag>          Only check sites with this tag (repeatable)
      --exit-on <level>    Exit 1 on: fail (default), warn or never
      --concurrency <n>    Sites checked in parallel (overrides the config)
      --no-slack           Do not send a Slack notification
  -h, --help               Show this help
  -v, --version            Show the version

Exit codes: 0 ok, 1 threshold reached or notification failed, 2 usage or config error.`;

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  fetch: FetchFn;
  tls: TlsProbe;
  now: () => number;
  writeFile: (path: string, content: string) => Promise<void>;
}

export function defaultIo(): Io {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    fetch: globalThis.fetch,
    tls: probeCertificate,
    now: () => Date.now(),
    writeFile: (path, content) => writeFile(path, content, 'utf8'),
  };
}

class UsageError extends Error {}

function parseCli(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      config: { type: 'string', short: 'c', default: 'fleet.yml' },
      json: { type: 'boolean', default: false },
      'json-file': { type: 'string' },
      markdown: { type: 'string' },
      tag: { type: 'string', multiple: true },
      'exit-on': { type: 'string' },
      concurrency: { type: 'string' },
      'no-slack': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  const exitOn = values['exit-on'];
  if (exitOn !== undefined && !['warn', 'fail', 'never'].includes(exitOn)) {
    throw new UsageError('--exit-on must be warn, fail or never');
  }
  const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new UsageError('--concurrency must be a positive integer');
  }
  return { ...values, exitOn: exitOn as FleetConfig['exitOn'] | undefined, concurrency };
}

function runUrl(env: Io['env']): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

async function notify(config: FleetConfig, report: FleetReport, io: Io): Promise<boolean> {
  const slack = config.slack;
  if (!slack || !shouldNotify(report, slack)) return true;
  const webhook = io.env[slack.webhookUrlEnv];
  if (!webhook) {
    io.stderr(`Slack: ${slack.webhookUrlEnv} is not set, notification skipped.\n`);
    return true;
  }
  try {
    await sendSlack(io.fetch, webhook, buildSlackPayload(report, runUrl(io.env)), config.timeoutMs);
    io.stderr('Slack: notification sent.\n');
    return true;
  } catch (error) {
    io.stderr(`Slack: notification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  }
}

/** Runs the CLI and returns the process exit code. */
export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  let args: ReturnType<typeof parseCli>;
  try {
    args = parseCli(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.help) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (args.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  let config: FleetConfig;
  try {
    config = await loadConfig(args.config);
  } catch (error) {
    if (error instanceof ConfigError) {
      io.stderr(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const tags = args.tag ?? [];
  if (tags.length > 0) {
    config.sites = config.sites.filter((site) => site.tags.some((tag) => tags.includes(tag)));
    if (config.sites.length === 0) {
      io.stderr(`No sites match --tag ${tags.join(', ')}.\n`);
      return 2;
    }
  }
  if (args.concurrency !== undefined) config.concurrency = args.concurrency;
  if (args.exitOn !== undefined) config.exitOn = args.exitOn;

  const http = createHttpClient({
    fetch: io.fetch,
    timeoutMs: config.timeoutMs,
    userAgent: config.userAgent,
    now: io.now,
  });
  const total = config.sites.length;
  let done = 0;
  const progress = (site: SiteResult): void => {
    done += 1;
    io.stderr(`[${done}/${total}] ${site.status.padEnd(4)} ${site.name}\n`);
  };
  const deps = { http, tls: io.tls, wporg: createWordPressOrg(http), now: () => new Date(io.now()) };
  const report = await runFleet(config, deps, { onSite: progress });

  io.stdout(args.json ? renderJson(report) : `\n${renderConsole(report)}\n`);
  if (args['json-file']) await io.writeFile(args['json-file'], renderJson(report));
  if (args.markdown) await io.writeFile(args.markdown, renderMarkdown(report));

  const notified = args['no-slack'] ? true : await notify(config, report, io);
  const thresholdReached = config.exitOn !== 'never' && atLeast(report.status, config.exitOn);
  return thresholdReached || !notified ? 1 : 0;
}
