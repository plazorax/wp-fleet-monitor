import type { FleetReport, Severity } from '../types.ts';
import { cell, COLUMNS, findCheck, pluginCell, problems, sites } from './shared.ts';

const ICON: Record<Severity, string> = { ok: '✅', warn: '⚠️', fail: '❌' };

/** Escapes characters that would break a Markdown table cell or inline formatting. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\|*_`[\]<>]/g, (char) => `\\${char}`).replace(/\r?\n/g, ' ');
}

/** GitHub-flavoured Markdown, suitable for $GITHUB_STEP_SUMMARY. */
export function renderMarkdown(report: FleetReport): string {
  const { ok, warn, fail, total } = report.summary;
  const lines = [
    `## ${ICON[report.status]} WordPress fleet: ${report.status.toUpperCase()}`,
    '',
    `${sites(total)}: ${ok} ok, ${warn} warn, ${fail} fail. Generated ${report.generatedAt}.`,
    '',
    '| Site | Status | HTTP | TLS | WordPress | REST | Plugins |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const site of report.sites) {
    const cells = [
      `[${escapeMarkdown(site.name)}](${site.url.replace(/\)/g, '%29')})`,
      `${ICON[site.status]} ${site.status}`,
      ...COLUMNS.map((id) => escapeMarkdown(cell(findCheck(site, id)))),
      escapeMarkdown(pluginCell(site)),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }

  const withProblems = report.sites.filter((site) => problems(site).length > 0);
  if (withProblems.length > 0) {
    lines.push('', '### Problems');
    for (const site of withProblems) {
      lines.push('', `**${escapeMarkdown(site.name)}**`, '');
      for (const check of problems(site)) {
        lines.push(`- \`${check.status}\` ${escapeMarkdown(check.id)}: ${escapeMarkdown(check.message)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
