import type { FetchFn } from './http.ts';
import { problems, sites } from './report/shared.ts';
import { atLeast } from './severity.ts';
import type { FleetReport, Severity, SlackSettings } from './types.ts';

/** Keeps the message well inside Slack's 50-block and 3000-character section limits. */
const MAX_SITES = 20;
const MAX_SECTION_CHARS = 2_900;

const EMOJI: Record<Severity, string> = { ok: ':white_check_mark:', warn: ':warning:', fail: ':x:' };

interface Block {
  type: string;
  text?: { type: 'mrkdwn' | 'plain_text'; text: string };
  elements?: { type: 'mrkdwn'; text: string }[];
}

export interface SlackPayload {
  text: string;
  blocks: Block[];
}

/** Slack mrkdwn needs only &, < and > escaped. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function shouldNotify(report: FleetReport, settings: SlackSettings): boolean {
  return atLeast(report.status, settings.notifyOn);
}

/** Incoming-webhook payload listing only the sites that need attention. */
export function buildSlackPayload(report: FleetReport, runUrl?: string): SlackPayload {
  const { ok, warn, fail, total } = report.summary;
  const headline = `WordPress fleet: ${fail} fail, ${warn} warn, ${ok} ok (${sites(total)})`;
  const blocks: Block[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `${EMOJI[report.status]} *${headline}*` } },
  ];

  const flagged = report.sites.filter((site) => site.status !== 'ok');
  for (const site of flagged.slice(0, MAX_SITES)) {
    const lines = problems(site)
      .filter((check) => check.status === 'warn' || check.status === 'fail')
      .map((check) => `• \`${check.status}\` ${check.id}: ${escapeSlack(check.message)}`);
    let text = `${EMOJI[site.status]} *<${site.url}|${escapeSlack(site.name)}>*\n${lines.join('\n')}`;
    if (text.length > MAX_SECTION_CHARS) text = `${text.slice(0, MAX_SECTION_CHARS - 1)}…`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text } });
  }

  const footer: string[] = [];
  const hidden = flagged.length - MAX_SITES;
  if (hidden > 0) footer.push(`…and ${hidden} more ${hidden === 1 ? 'site' : 'sites'}`);
  if (runUrl) footer.push(`<${runUrl}|Full report>`);
  if (footer.length > 0) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: footer.join(' · ') }] });

  return { text: headline, blocks };
}

export async function sendSlack(
  fetch: FetchFn,
  webhookUrl: string,
  payload: SlackPayload,
  timeoutMs: number,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Slack webhook returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
}
