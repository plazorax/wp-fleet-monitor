import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { branchOf, compareVersions, parseVersion, type Version } from '../src/version.ts';
import { VERSION } from '../src/version-info.ts';

function v(input: string): Version {
  const parsed = parseVersion(input);
  if (!parsed) throw new Error(`unparsable ${input}`);
  return parsed;
}

describe('parseVersion', () => {
  it.each([
    ['6.9.10', [6, 9, 10], null],
    ['7.1', [7, 1], null],
    ['7.2-alpha-64319', [7, 2], 'alpha-64319'],
    ['6.5-RC1', [6, 5], 'RC1'],
    ['2.3.4.1', [2, 3, 4, 1], null],
    ['v1.2', [1, 2], null],
    [' 5.7.2\n', [5, 7, 2], null],
  ])('parses %j', (input, parts, pre) => {
    expect(parseVersion(input)).toMatchObject({ parts, pre });
  });

  it.each(['trunk', '', 'latest', '1..2', '.1'])('rejects %j', (input) => {
    expect(parseVersion(input)).toBeNull();
  });
});

describe('compareVersions', () => {
  it.each([
    ['6.9.10', '6.9.9', 1],
    ['6.9.9', '6.9.10', -1],
    ['7.1', '7.1.0', 0],
    ['7.1.3', '7.1.3', 0],
    ['7.2-alpha-64319', '7.1.3', 1],
    ['7.2-alpha-1', '7.2', -1],
    ['7.2-beta1', '7.2-alpha-99', 1],
    ['7.2-RC1', '7.2-beta3', 1],
    ['7.2-RC2', '7.2-RC1', 1],
    ['10.0', '9.9.9', 1],
  ])('%s vs %s -> %i', (a, b, expected) => {
    expect(compareVersions(v(a), v(b))).toBe(expected);
  });
});

describe('branchOf', () => {
  it('uses major.minor', () => {
    expect(branchOf(v('6.9.10'))).toBe('6.9');
    expect(branchOf(v('7.0'))).toBe('7.0');
    expect(branchOf(v('7.2-alpha-64319'))).toBe('7.2');
  });
});

describe('VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
