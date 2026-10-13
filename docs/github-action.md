# GitHub Action

The repository is also a GitHub Action. Keep `fleet.yml` in a repository (a private one is
fine), and a scheduled workflow checks the fleet, writes the report to the job summary and,
optionally, posts to Slack.

## Example workflow

`.github/workflows/wordpress-fleet.yml`:

```yaml
name: WordPress fleet

on:
  schedule:
    - cron: '17 */6 * * *'   # every 6 hours, at minute 17 (UTC)
  workflow_dispatch:

permissions:
  contents: read

jobs:
  monitor:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7

      - id: fleet
        uses: plazorax/wp-fleet-monitor@v0.1.0
        with:
          config: fleet.yml
          slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}

      - name: Keep the JSON report
        if: always() && steps.fleet.outputs.report != ''
        uses: actions/upload-artifact@v7
        with:
          name: wp-fleet-report
          path: ${{ steps.fleet.outputs.report }}
```

The action builds and runs whatever code the ref points to. A tag can be moved, so for
production use pin the full commit SHA of the release instead of `v0.1.0`.

GitHub runs scheduled workflows on the default branch only, may start them a few minutes late
under load, and disables them in public repositories after 60 days without activity.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `config` | `fleet.yml` | Path to the config, relative to the workspace. |
| `tags` | empty | Space-separated tags; only sites with one of them are checked. |
| `exit-on` | empty | `fail`, `warn` or `never`; empty uses `exitOn` from the config. |
| `slack-webhook-url` | empty | Webhook URL from a secret. Exported as `SLACK_WEBHOOK_URL` only when set. |
| `node-version` | `22` | Node.js version installed with `actions/setup-node`. |

If your config uses a different `webhookUrlEnv`, leave `slack-webhook-url` empty and set that
variable with `env:` on the step or job instead.

## Outputs

| Output | Description |
| --- | --- |
| `status` | `ok`, `warn` or `fail`. |
| `report` | Path to the JSON report under `$RUNNER_TEMP`. |

Both are set even when the step fails because of `exit-on`, so later steps with
`if: always()` can use them. They are empty when the config is invalid.

## What the step does

The step fails (exit code 1) when the run reaches `exit-on`, which makes the failure visible in
the Actions tab and in GitHub's own notifications. The table is printed to the log and the
Markdown report is written to `$GITHUB_STEP_SUMMARY`.

## Why a composite action

`action.yml` is a composite action with three steps: `actions/setup-node`, `npm ci` and
`npm run build` in the action's own directory, then `node dist/cli.js`. The alternative, a JavaScript
action (`runs.using: node…`), would need a bundled `dist/` committed to the repository and kept in
sync with the sources on every change. Building on the runner keeps the repository source-only
and runs exactly the reviewed TypeScript, at the cost of an `npm ci` and a `tsc` build on every run.

`actions/setup-node` changes the Node.js version for the rest of the job. If that matters,
run the monitor in its own job, as in the example.

## Running the CLI yourself in a workflow

Without the action:

```yaml
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npx --yes github:plazorax/wp-fleet-monitor --config fleet.yml --markdown "$GITHUB_STEP_SUMMARY"
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```
