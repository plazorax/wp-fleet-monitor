import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/concurrency.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` tasks at once and keeps input order', async () => {
    let active = 0;
    let peak = 0;
    const items = [30, 5, 20, 1, 15, 10, 2, 25];
    const results = await mapWithConcurrency(items, 3, async (ms, index) => {
      active++;
      peak = Math.max(peak, active);
      await delay(ms);
      active--;
      return index * 10;
    });
    expect(peak).toBe(3);
    expect(results).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
  });

  it('starts the next task as soon as a slot frees up', async () => {
    const finished: number[] = [];
    await mapWithConcurrency([0, 1, 2], 2, async (item) => {
      await delay(item === 0 ? 40 : 1);
      finished.push(item);
    });
    // Item 2 takes the slot item 1 freed and finishes before the slow item 0.
    expect(finished).toEqual([1, 2, 0]);
  });

  it('handles fewer items than the limit and empty input', async () => {
    expect(await mapWithConcurrency([1], 10, (n) => Promise.resolve(n + 1))).toEqual([2]);
    expect(await mapWithConcurrency([], 2, () => Promise.resolve(1))).toEqual([]);
  });

  it('rejects an invalid limit', async () => {
    await expect(mapWithConcurrency([1], 0, () => Promise.resolve(1))).rejects.toThrow(RangeError);
  });
});
