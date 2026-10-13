import type { FleetReport } from '../types.ts';
import { cell, COLUMNS, findCheck, pluginCell, problems, sites } from './shared.ts';

const HEADERS = ['Site', 'Status', 'HTTP', 'TLS', 'WordPress', 'REST', 'Plugins'];

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length))) ?? [];
  const line = (row: string[]): string =>
    row
      .map((value, i) => value.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  const [header, ...body] = rows;
  return [line(header ?? []), widths.map((width) => '-'.repeat(width)).join('  '), ...body.map(line)].join('\n');
}

/** Plain-text table plus a list of problems; no colours so it reads the same in CI logs. */
export function renderConsole(report: FleetReport): string {
  const rows = report.sites.map((site) => [
    site.name,
    site.status.toUpperCase(),
    ...COLUMNS.map((id) => cell(findCheck(site, id))),
    pluginCell(site),
  ]);
  const { ok, warn, fail, total } = report.summary;
  const out = [table([HEADERS, ...rows]), '', `${sites(total)}: ${ok} ok, ${warn} warn, ${fail} fail`];

  const details = report.sites.flatMap((site) =>
    problems(site).map(
      (check) => `  ${check.status.toUpperCase().padEnd(7)} ${site.name} [${check.id}] ${check.message}`,
    ),
  );
  if (details.length > 0) out.push('', 'Problems:', ...details);
  return out.join('\n');
}
