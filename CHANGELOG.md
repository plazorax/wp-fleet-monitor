# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-13

### Added

- `wp-fleet-monitor` CLI reading a validated `fleet.yml` (sites, tags, plugin slugs,
  thresholds, Slack settings), with every config problem reported at once.
- Checks per site: home page status and response time, TLS certificate expiry and trust via
  `node:tls`, WordPress detection (generator tag, feed generator, REST `Link` header, `wp/v2`
  namespace), core version against `api.wordpress.org/core/version-check/1.7/` including older
  security branches, REST API reachability, and plugin `readme.txt` Stable tag against
  `api.wordpress.org/plugins/info/1.2/`, including plugins closed on WordPress.org.
- `ok` / `warn` / `fail` severity per check, site and run, plus `unknown` and `skip`;
  configurable exit level (`exitOn`, `--exit-on`).
- Concurrency limit across sites; WordPress.org lookups made once per run.
- Console table, `--json`, `--json-file` and `--markdown` output (for `$GITHUB_STEP_SUMMARY`).
- Slack incoming-webhook notification on `warn` or `fail`, with the webhook URL read from an
  environment variable.
- `--tag` filtering, `--concurrency` and `--no-slack` options.
- Composite GitHub Action (`action.yml`) with `status` and `report` outputs, and an example
  scheduled workflow.
