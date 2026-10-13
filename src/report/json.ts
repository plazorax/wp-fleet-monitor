import type { FleetReport } from '../types.ts';

/** Stable, pretty-printed JSON; the shape is the `FleetReport` type. */
export function renderJson(report: FleetReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
