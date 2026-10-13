import { describe, expect, it } from 'vitest';
import { renderConsole } from '../src/report/console.ts';
import { renderJson } from '../src/report/json.ts';
import { escapeMarkdown, renderMarkdown } from '../src/report/markdown.ts';
import { DOWN, HEALTHY, OUTDATED, report } from './fixtures.ts';

describe('renderConsole', () => {
  it('renders an aligned table followed by the problems', () => {
    expect(renderConsole(report(HEALTHY, OUTDATED, DOWN))).toBe(
      [
        'Site       Status  HTTP        TLS           WordPress       REST  Plugins',
        '---------  ------  ----------  ------------  --------------  ----  ------------',
        'Blog       OK      200 120 ms  80 days       7.1.3           ok    -',
        'Shop | EU  WARN    200 340 ms  WARN 12 days  UNKNOWN hidden  ok    1 warn, 1 ok',
        'Old site   FAIL    FAIL down   FAIL error    skip            skip  -',
        '',
        '3 sites: 1 ok, 1 warn, 1 fail',
        '',
        'Problems:',
        '  WARN    Shop | EU [tls] Certificate expires in 12 days (2026-10-25).',
        '  UNKNOWN Shop | EU [wordpress] WordPress detected (rest-link) but the core version is not public.',
        '  WARN    Shop | EU [plugin:woocommerce] Installed 10.1 is behind 10.2 on WordPress.org.',
        '  FAIL    Old site [http] Request failed: ENOTFOUND old.example',
        '  FAIL    Old site [tls] TLS handshake failed: ENOTFOUND old.example',
      ].join('\n'),
    );
  });

  it('omits the problems section when everything is ok', () => {
    expect(renderConsole(report(HEALTHY))).not.toContain('Problems:');
  });
});

describe('renderMarkdown', () => {
  it('renders a summary table and per-site problems', () => {
    expect(renderMarkdown(report(HEALTHY, OUTDATED, DOWN))).toBe(
      [
        '## ❌ WordPress fleet: FAIL',
        '',
        '3 sites: 1 ok, 1 warn, 1 fail. Generated 2026-10-13T12:00:00.000Z.',
        '',
        '| Site | Status | HTTP | TLS | WordPress | REST | Plugins |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| [Blog](https://blog.example/) | ✅ ok | 200 120 ms | 80 days | 7.1.3 | ok | - |',
        '| [Shop \\| EU](https://shop.example/) | ⚠️ warn | 200 340 ms | WARN 12 days | UNKNOWN hidden | ok | 1 warn, 1 ok |',
        '| [Old site](https://old.example/) | ❌ fail | FAIL down | FAIL error | skip | skip | - |',
        '',
        '### Problems',
        '',
        '**Shop \\| EU**',
        '',
        '- `warn` tls: Certificate expires in 12 days (2026-10-25).',
        '- `unknown` wordpress: WordPress detected (rest-link) but the core version is not public.',
        '- `warn` plugin:woocommerce: Installed 10.1 is behind 10.2 on WordPress.org.',
        '',
        '**Old site**',
        '',
        '- `fail` http: Request failed: ENOTFOUND old.example',
        '- `fail` tls: TLS handshake failed: ENOTFOUND old.example',
        '',
      ].join('\n'),
    );
  });

  it('escapes table and formatting characters', () => {
    expect(escapeMarkdown('a|b *c* <d>\nnext')).toBe('a\\|b \\*c\\* \\<d\\> next');
  });
});

describe('renderJson', () => {
  it('round-trips the report', () => {
    const value = report(HEALTHY, DOWN);
    expect(JSON.parse(renderJson(value))).toEqual(value);
    expect(renderJson(value).endsWith('\n')).toBe(true);
  });
});
