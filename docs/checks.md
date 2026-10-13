# Checks and severity

Every check returns one of five statuses:

| Status | Meaning |
| --- | --- |
| `ok` | Nothing to do. |
| `warn` | Needs attention soon. |
| `fail` | Broken, insecure or about to break. |
| `unknown` | The check ran but the site does not expose enough to decide (e.g. a hidden version). |
| `skip` | The check did not run because the home page could not be fetched at all. |

A site's status is the worst `ok` / `warn` / `fail` among its checks; `unknown` and `skip` do
not count. The run's status is the worst site status. The CLI exits with code 1 when the run
reaches `exitOn` (default `fail`).

## Requests per site

1. `GET <url>` (home page, redirects followed) and a TLS handshake with the host, in parallel.
2. If the home page answered: `GET <REST root>?_fields=name,namespaces`, `GET <url>?feed=rss2`
   (only when the generator tag has no version) and `GET <url>wp-content/plugins/<slug>/readme.txt`
   for each configured plugin, in parallel.
3. WordPress.org: `core/version-check/1.7/` and `plugins/info/1.2/` lookups. Each one is made
   at most once per run and shared by all sites.

## http

Fetches the home page and times it until the whole body has been read.

| Condition | Status |
| --- | --- |
| No response: DNS, connection or TLS error, or timeout | `fail` |
| HTTP 4xx or 5xx (after redirects) | `fail` |
| Time ≥ `responseTimeMs.fail` | `fail` |
| Time ≥ `responseTimeMs.warn` | `warn` |
| Otherwise | `ok` (a redirect to another URL is mentioned in the message) |

If there is no response at all, `wordpress`, `rest` and the plugin checks are `skip`.

## tls

Opens a TLS connection with `node:tls` (SNI set to the host) and reads the peer certificate.
Verification is reported rather than enforced, so expired or mismatched certificates can still
be inspected.

| Condition | Status |
| --- | --- |
| Site URL is `http://` | `warn` |
| Handshake failed or timed out | `fail` |
| Certificate already expired | `fail` |
| Chain or hostname not trusted by Node's CA store (e.g. `ERR_TLS_CERT_ALTNAME_INVALID`) | `fail` |
| Days left ≤ `sslDays.fail` | `fail` |
| Days left ≤ `sslDays.warn` | `warn` |
| Otherwise | `ok` |

Days left are whole days, rounded down.

## wordpress

**Detection.** A site counts as WordPress when any of these public signals is present:

| Signal | Where | Gives the version? |
| --- | --- | --- |
| Generator tag | `<meta name="generator" content="WordPress 6.9.10">` in the home page | yes |
| REST API link | `Link: <…/wp-json/>; rel="https://api.w.org/"` header or the same `<link>` element | no |
| Feed generator | `<generator>https://wordpress.org/?v=6.9.10</generator>` in `?feed=rss2` (Atom `version=` too) | yes |
| REST namespace | `wp/v2` in the REST API index | no |

The REST API index does not include the core version, so it is used for detection only.
Many sites remove the generator tag and the feed generator (security plugins, some hosts and
themes do this), and then the version is `unknown`. Other fingerprints such as `?ver=` on
asset URLs are not used because plugins and caching layers rewrite them.

**Core version.** The version is compared with `api.wordpress.org/core/version-check/1.7/`.
Its first offer is the newest release; the other offers list the newest release of each older
branch that still receives security fixes.

| Condition | Status |
| --- | --- |
| No signal at all | `warn` |
| Version hidden or not parseable, or WordPress.org unavailable | `unknown` |
| Same as or newer than the newest release (pre-releases such as `7.2-alpha-64319` count as newer) | `ok` |
| Older branch, but at that branch's newest release (e.g. `6.9.10` when `7.1.3` is out) | `warn` |
| Behind its own branch's newest release (e.g. `6.9.8` when `6.9.10` exists) | `fail` |
| Branch no longer in the list (no security releases) | `fail` |

Missing a release on your own branch is a `fail` because those are maintenance and security
releases that WordPress normally installs automatically, so being behind usually means
automatic updates are off or broken.

## rest

Requests the REST API root advertised in the `Link` header (or `<url>wp-json/` if none) with
`_fields=name,namespaces`, which keeps the response small (on wordpress.org/news it was 463 bytes
instead of about 585 KB for the full index).

| Condition | Status |
| --- | --- |
| HTTP 200 with a JSON `namespaces` list including `wp/v2` | `ok` |
| HTTP 200 with namespaces but no `wp/v2` | `warn` |
| HTTP 401 or 403 (deliberately closed to anonymous visitors) | `warn` |
| Any other status, a body that is not a REST index (often an HTML firewall page), or no response | `fail` |

## plugin:&lt;slug&gt;

Reads `wp-content/plugins/<slug>/readme.txt` from the site and takes its `Stable tag:` value.
In parallel it asks
`api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=<slug>` for the
current `version`. A closed plugin answers HTTP 404 with
`{"error":"closed","closed_date":"…","reason":"security-issue","reason_text":"Security Issue"}`.

| Condition | Status |
| --- | --- |
| Closed on WordPress.org with reason `security-issue` | `fail` |
| Closed on WordPress.org for any other reason | `warn` |
| `readme.txt` not readable: non-200, an HTML page (soft 404), no `Stable tag`, or request error | `unknown` |
| `Stable tag` is not a version (e.g. `trunk`) | `unknown` |
| Plugin not on WordPress.org, or the lookup failed | `unknown` |
| Older than WordPress.org | `warn` |
| Same or newer | `ok` |

The closure check runs even when `readme.txt` is hidden, because the config says the plugin
is installed; the tool cannot confirm that on its own. An outdated plugin is a `warn`, not a
`fail`: the tool has no vulnerability data, so it cannot tell a security release from a
feature release.

## Limitations

- **Public signals only.** No credentials, no plugin on the site. Anything a site hides is
  `unknown`, and a site can also fake what it shows.
- **Stable tag is not the installed version.** It is the version the plugin author declared
  in the readme. It usually matches the installed version for WordPress.org plugins, but not
  always, and many hosts block `readme.txt` (the plugin check then says `unknown`).
- **Default paths.** Plugins are looked for in `wp-content/plugins/` under the configured URL;
  a renamed or moved content directory is not discovered. Only `readme.txt` (lower case) is read.
- **One home page request.** Response time is a single sample from the runner's location, not
  an average, and includes the full HTML download.
- **No vulnerability database.** Versions are compared, not matched against CVEs.
- **Certificate on the configured host only.** Redirect targets on other hosts are not probed.
- **Themes are not checked** in v0.1.

## What was observed on live sites

On 2026-10-13 the CLI was run against a few public sites to confirm the detection paths:

- `https://wordpress.org/news/` and `https://make.wordpress.org/core/`: detected from the
  generator tag (`WordPress 7.2-alpha-64319`, reported `ok` as ahead of the 7.1.3 release) and
  the `Link` header; REST `ok`. On wordpress.org/news the `jetpack` and `akismet` readmes were
  readable, and the Jetpack readme showed 16.3 while WordPress.org listed 16.3.1 (`warn`).
- Listing `display-widgets` (closed in 2021 for a security issue) for wordpress.org/news gave
  `fail` with "Closed on WordPress.org since 2021-01-30 (Security Issue)", although that site
  does not run it: the closure check trusts the config.
- `https://example.com/`: not WordPress, so `wordpress` was `warn` and `rest` `fail` (HTTP 404).
- `https://expired.badssl.com/` and `https://wrong.host.badssl.com/`: `tls` was `fail` with
  "Certificate expired on 2015-04-12" and `ERR_TLS_CERT_ALTNAME_INVALID`.

The feed fallback is covered by unit tests; on the sites above the generator tag was present,
so it was not needed.
