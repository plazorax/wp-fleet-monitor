import { mapWithConcurrency } from './concurrency.ts';
import { worst } from './severity.ts';
import { checkSite, type Deps } from './site.ts';
import type { FleetConfig, FleetReport, Severity, SiteResult } from './types.ts';

export interface RunOptions {
  /** Called as each site finishes, e.g. for progress output. */
  onSite?: (result: SiteResult) => void;
}

export function summarize(sites: SiteResult[], generatedAt: Date): FleetReport {
  const summary: Record<Severity, number> & { total: number } = { ok: 0, warn: 0, fail: 0, total: sites.length };
  for (const site of sites) summary[site.status] += 1;
  return {
    generatedAt: generatedAt.toISOString(),
    status: worst(sites.map((site) => site.status)),
    summary,
    sites,
  };
}

/** Checks every site in the config, at most `config.concurrency` at a time. */
export async function runFleet(config: FleetConfig, deps: Deps, options: RunOptions = {}): Promise<FleetReport> {
  const siteOptions = { thresholds: config.thresholds, timeoutMs: config.timeoutMs };
  const sites = await mapWithConcurrency(config.sites, config.concurrency, async (site) => {
    let result: SiteResult;
    try {
      result = await checkSite(site, siteOptions, deps);
    } catch (error) {
      // checkSite handles network errors itself; this is a last-resort guard against bugs.
      result = {
        name: site.name,
        url: site.url,
        tags: site.tags,
        status: 'fail',
        checks: [{ id: 'internal', status: 'fail', summary: 'error', message: `Unexpected error: ${String(error)}` }],
      };
    }
    options.onSite?.(result);
    return result;
  });
  return summarize(sites, deps.now());
}
