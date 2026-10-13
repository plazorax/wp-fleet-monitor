# Configuration

The CLI reads a YAML file, `fleet.yml` by default. Only `sites` is required. A commented
example with every default is in [`examples/fleet.yml`](../examples/fleet.yml).

The config is validated before any request is made. All problems are reported at once with
their path, for example `sites[2].plugins[0]: "Akismet" is not a WordPress.org plugin slug`,
and the CLI exits with code 2. Unknown keys are errors, so typos do not pass silently.

## Top level

| Key | Default | Description |
| --- | --- | --- |
| `concurrency` | `4` | Sites checked in parallel. Requests for one site also run in parallel. |
| `timeoutMs` | `15000` | Timeout for each request and each TLS handshake. |
| `exitOn` | `fail` | Exit with code 1 when the run is at least this bad: `fail`, `warn` or `never`. |
| `userAgent` | `wp-fleet-monitor/0.1.0 (+https://github.com/plazorax/wp-fleet-monitor)` | Sent with every request. |
| `thresholds` | see below | Response time and certificate limits. |
| `notifications.slack` | off | Slack settings, see below. |
| `sites` | required | List of sites. |

## Thresholds

| Key | Default | Meaning |
| --- | --- | --- |
| `thresholds.responseTimeMs.warn` | `2000` | Home page fetch time in ms at or above which the HTTP check warns. |
| `thresholds.responseTimeMs.fail` | `8000` | ... at or above which it fails. Must be ≥ `warn`. |
| `thresholds.sslDays.warn` | `21` | Days left on the certificate at or below which the TLS check warns. |
| `thresholds.sslDays.fail` | `7` | ... at or below which it fails. Must be ≤ `warn`. |

Thresholds apply to every site; there are no per-site overrides in v0.1.

## Sites

```yaml
sites:
  - url: https://example.com/blog/   # required, http:// or https://
    name: Example blog               # optional, defaults to the host
    tags: [client-a, production]     # optional, used by --tag
    plugins: [akismet, woocommerce]  # optional WordPress.org plugin slugs
```

- `url` is normalised to end with `/`, so a WordPress install in a sub-directory works:
  `wp-json/`, `?feed=rss2` and `wp-content/plugins/...` are resolved below it. Use the
  canonical URL of the site; redirects are followed but paths are built from the configured URL.
- `plugins` are WordPress.org slugs (the directory name in `wp-content/plugins/`). Duplicates
  are removed. Plugins that are not on WordPress.org are reported as `unknown`.
- Two sites with the same normalised URL are a config error.

## Slack

```yaml
notifications:
  slack:
    webhookUrlEnv: SLACK_WEBHOOK_URL   # default
    notifyOn: warn                     # warn (default) or fail
```

The webhook URL is a secret, so the config only names the environment variable that holds
it. A message is sent when the run is at least `notifyOn`; nothing is sent for an all-ok run.
If the variable is not set, the CLI prints a note and skips the message. If Slack rejects the
request, the CLI prints the error and exits with code 1. The message lists each site that is
not ok with its `warn` and `fail` checks (at most 20 sites) and, inside GitHub Actions, a link
to the workflow run.

To create a webhook, add an "Incoming Webhooks" app to a Slack workspace and copy the URL
it gives you for a channel.

## Command line

```text
wp-fleet-monitor [options]

  -c, --config <file>      Fleet config (default: fleet.yml)
      --json               Print the report as JSON instead of a table
      --json-file <file>   Also write the JSON report to a file
      --markdown <file>    Also write a Markdown report (e.g. "$GITHUB_STEP_SUMMARY")
      --tag <tag>          Only check sites with this tag (repeatable)
      --exit-on <level>    Exit 1 on: fail (default), warn or never
      --concurrency <n>    Sites checked in parallel (overrides the config)
      --no-slack           Do not send a Slack notification
  -h, --help               Show this help
  -v, --version            Show the version
```

Progress lines (`[2/5] warn Example`) go to stderr, so `--json` output on stdout can be piped.
`--markdown` overwrites the file; GitHub creates a fresh `$GITHUB_STEP_SUMMARY` file for each
step, so pointing it there is safe.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The run is below the `exitOn` level (or `exitOn: never`). |
| `1` | The run reached `exitOn`, or the Slack message could not be delivered. |
| `2` | Bad arguments, invalid or unreadable config, no site matches `--tag`, or an unexpected error such as an unwritable `--json-file`. |

## JSON report

`--json` and `--json-file` write the `FleetReport` type from [`src/types.ts`](../src/types.ts):

```json
{
  "generatedAt": "2026-10-13T06:33:44.689Z",
  "status": "warn",
  "summary": { "ok": 1, "warn": 1, "fail": 0, "total": 2 },
  "sites": [
    {
      "name": "WordPress News",
      "url": "https://wordpress.org/news/",
      "tags": [],
      "status": "warn",
      "checks": [
        { "id": "http", "status": "ok", "summary": "200 897 ms", "message": "HTTP 200 in 897 ms." }
      ]
    }
  ]
}
```

The example is shortened; every site lists all of its checks.
