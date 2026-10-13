import { describe, expect, it } from 'vitest';
import {
  restNamespaces,
  restRootFromHtml,
  restRootFromLinkHeader,
  stableTagFromReadme,
  versionFromFeed,
  versionFromGeneratorMeta,
} from '../src/detect.ts';

describe('versionFromGeneratorMeta', () => {
  it('reads the WordPress generator tag in any attribute order and quoting', () => {
    expect(versionFromGeneratorMeta('<meta name="generator" content="WordPress 6.9.10" />')).toBe('6.9.10');
    expect(versionFromGeneratorMeta("<META content='WordPress 7.2-alpha-64319' NAME='Generator'>")).toBe(
      '7.2-alpha-64319',
    );
  });

  it('ignores generator tags from other software', () => {
    const page =
      '<meta name="generator" content="Seriously Simple Podcasting 3.17.0" /><meta name="generator" content="WordPress 7.1.3" />';
    expect(versionFromGeneratorMeta(page)).toBe('7.1.3');
    expect(versionFromGeneratorMeta('<meta name="generator" content="Elementor 3.30.0">')).toBeNull();
    expect(versionFromGeneratorMeta('<meta name="description" content="WordPress 6.0 tips">')).toBeNull();
  });
});

describe('versionFromFeed', () => {
  it('reads RSS and Atom generators', () => {
    expect(versionFromFeed('<channel><generator>https://wordpress.org/?v=6.9.10</generator></channel>')).toBe('6.9.10');
    expect(versionFromFeed('<generator uri="https://wordpress.org/" version="7.1.3">WordPress</generator>')).toBe(
      '7.1.3',
    );
  });

  it('returns null for other feeds', () => {
    expect(versionFromFeed('<generator>Hugo</generator>')).toBeNull();
    expect(versionFromFeed('<html>not a feed</html>')).toBeNull();
  });
});

describe('REST API discovery', () => {
  it('finds the api.w.org link among several Link values', () => {
    const header =
      '<https://example.com/wp-json/>; rel="https://api.w.org/", <https://example.com/wp-json/wp/v2/pages/2>; rel="alternate"; type="application/json"';
    expect(restRootFromLinkHeader(header)).toBe('https://example.com/wp-json/');
    expect(restRootFromLinkHeader('<https://example.com/?rest_route=/>; rel="https://api.w.org/"')).toBe(
      'https://example.com/?rest_route=/',
    );
    expect(restRootFromLinkHeader('<https://wp.me/x>; rel=shortlink')).toBeNull();
    expect(restRootFromLinkHeader(null)).toBeNull();
  });

  it('finds the link element in HTML', () => {
    expect(restRootFromHtml('<link rel="https://api.w.org/" href="https://example.com/wp-json/" />')).toBe(
      'https://example.com/wp-json/',
    );
    expect(restRootFromHtml('<link rel="stylesheet" href="/style.css">')).toBeNull();
  });

  it('reads namespaces only from a REST index', () => {
    expect(restNamespaces('{"name":"Site","namespaces":["oembed/1.0","wp/v2"]}')).toEqual(['oembed/1.0', 'wp/v2']);
    expect(restNamespaces('{"code":"rest_no_route"}')).toBeNull();
    expect(restNamespaces('<html>Blocked</html>')).toBeNull();
  });
});

describe('stableTagFromReadme', () => {
  it('reads the Stable tag header', () => {
    const readme = '=== Akismet ===\nContributors: automattic\nTested up to: 7.1\nStable tag: 5.7.2\nLicense: GPLv2\n';
    expect(stableTagFromReadme(readme)).toBe('5.7.2');
    expect(stableTagFromReadme('=== Plugin ===\r\nstable tag:   trunk\r\n')).toBe('trunk');
    expect(stableTagFromReadme('<html>404</html>')).toBeNull();
  });
});
