# wp-fleet-monitor

![CI](https://github.com/plazorax/wp-fleet-monitor/actions/workflows/ci.yml/badge.svg)

A TypeScript CLI and GitHub Action that checks a list of WordPress sites on a schedule and
reports downtime, slow pages, expiring certificates and outdated core or plugin versions.

## Why

- Looking after many WordPress sites means the same checks again and again, by hand.
- An expired certificate or a missed core security release is cheap to catch early and
  expensive to notice late.
- A scheduled GitHub workflow is enough for a small fleet: no server and no agent on the sites.

## Install

Requires Node 20 or newer. Not on npm; install from GitHub (`prepare` builds `dist/`):

```sh
npm install --save-dev github:plazorax/wp-fleet-monitor   # or run once: npx github:plazorax/wp-fleet-monitor
```

To run it from GitHub Actions instead, see [docs/github-action.md](docs/github-action.md).

## Usage

```yaml
# fleet.yml
thresholds:
  responseTimeMs: { warn: 2000, fail: 8000 }
  sslDays: { warn: 21, fail: 7 }
notifications:
  slack: { webhookUrlEnv: SLACK_WEBHOOK_URL, notifyOn: warn }
sites:
  - name: WordPress News
    url: https://wordpress.org/news/
    plugins: [akismet, jetpack]
  - name: Make WordPress Core
    url: https://make.wordpress.org/core/
```

```sh
npx wp-fleet-monitor --config fleet.yml --markdown report.md
```

```text
Site                 Status  HTTP         TLS      WordPress        REST  Plugins
-------------------  ------  -----------  -------  ---------------  ----  ------------
WordPress News       WARN    200 1158 ms  70 days  7.2-alpha-64319  ok    1 warn, 1 ok
Make WordPress Core  OK      200 1891 ms  70 days  7.2-alpha-64319  ok    -

2 sites: 1 ok, 1 warn, 0 fail

Problems:
  WARN    WordPress News [plugin:jetpack] Installed 16.3 is behind 16.3.1 on WordPress.org.
```

All options are in [docs/configuration.md](docs/configuration.md).

## Features

- Checks HTTP status and response time, TLS certificate expiry and trust, and REST API reachability.
- Detects WordPress and its core version from the generator tag or the feed, and compares it
  with the WordPress.org release list, including older branches that still get security fixes.
- Reads plugin versions from public `readme.txt` files, compares them with WordPress.org,
  flags plugins closed there, and reports `unknown` when versions are hidden.
- Gives each check, site and run `ok`, `warn` or `fail`, and exits non-zero at a configurable level.
- Writes a console table, JSON, and Markdown for `$GITHUB_STEP_SUMMARY`.
- Sends an optional Slack incoming-webhook message only when something needs attention.
- Checks sites in parallel up to a limit; `yaml` is the only runtime dependency.

Detection methods and severity rules: [docs/checks.md](docs/checks.md).

## Status

v0.1.0 — reference implementation. It sees only what a site makes public, so hidden versions
stay `unknown`, and a readme "Stable tag" is not proof of what is installed. More in
[checks and limitations](docs/checks.md) and [development](docs/development.md).

## License

[MIT](LICENSE) © 2026 Oleksii Shaposhnikov
