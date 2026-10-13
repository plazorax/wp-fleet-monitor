import { describe, expect, it, vi } from 'vitest';
import type { FetchFn } from '../src/http.ts';
import { buildSlackPayload, escapeSlack, sendSlack, shouldNotify } from '../src/slack.ts';
import type { SiteResult } from '../src/types.ts';
import { DOWN, HEALTHY, OUTDATED, report } from './fixtures.ts';

describe('shouldNotify', () => {
  it('respects notifyOn', () => {
    const warnOnly = { webhookUrlEnv: 'X', notifyOn: 'warn' as const };
    const failOnly = { webhookUrlEnv: 'X', notifyOn: 'fail' as const };
    expect(shouldNotify(report(HEALTHY), warnOnly)).toBe(false);
    expect(shouldNotify(report(HEALTHY, OUTDATED), warnOnly)).toBe(true);
    expect(shouldNotify(report(HEALTHY, OUTDATED), failOnly)).toBe(false);
    expect(shouldNotify(report(DOWN), failOnly)).toBe(true);
  });
});

describe('buildSlackPayload', () => {
  it('lists only sites that need attention, with their warn/fail checks', () => {
    const payload = buildSlackPayload(report(HEALTHY, OUTDATED, DOWN), 'https://github.com/o/r/actions/runs/1');
    expect(payload).toEqual({
      text: 'WordPress fleet: 1 fail, 1 warn, 1 ok (3 sites)',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: ':x: *WordPress fleet: 1 fail, 1 warn, 1 ok (3 sites)*' } },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              ':warning: *<https://shop.example/|Shop | EU>*',
              '• `warn` tls: Certificate expires in 12 days (2026-10-25).',
              '• `warn` plugin:woocommerce: Installed 10.1 is behind 10.2 on WordPress.org.',
            ].join('\n'),
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              ':x: *<https://old.example/|Old site>*',
              '• `fail` http: Request failed: ENOTFOUND old.example',
              '• `fail` tls: TLS handshake failed: ENOTFOUND old.example',
            ].join('\n'),
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '<https://github.com/o/r/actions/runs/1|Full report>' }],
        },
      ],
    });
  });

  it('caps the number of sites and says how many were left out', () => {
    const sites: SiteResult[] = Array.from({ length: 25 }, (_, i) => ({
      ...DOWN,
      name: `Site ${i}`,
      url: `https://s${i}.example/`,
    }));
    const payload = buildSlackPayload(report(...sites));
    expect(payload.blocks).toHaveLength(1 + 20 + 1);
    expect(payload.blocks.at(-1)).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '…and 5 more sites' }],
    });
  });

  it('escapes Slack control characters', () => {
    expect(escapeSlack('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    const payload = buildSlackPayload(report({ ...DOWN, name: '<!channel>' }));
    expect(payload.blocks[1]?.text?.text).toContain('|&lt;!channel&gt;>');
  });
});

describe('sendSlack', () => {
  it('posts JSON to the webhook', async () => {
    const fetch = vi.fn<FetchFn>(() => Promise.resolve(new Response('ok')));
    await sendSlack(fetch, 'https://hooks.slack.test/T/B/x', { text: 'hi', blocks: [] }, 1000);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://hooks.slack.test/T/B/x');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"text":"hi","blocks":[]}',
    });
  });

  it('throws with Slack’s error body', async () => {
    const fetch = vi.fn<FetchFn>(() => Promise.resolve(new Response('invalid_payload', { status: 400 })));
    await expect(sendSlack(fetch, 'https://hooks.slack.test/x', { text: '', blocks: [] }, 1000)).rejects.toThrow(
      'Slack webhook returned HTTP 400: invalid_payload',
    );
  });
});
