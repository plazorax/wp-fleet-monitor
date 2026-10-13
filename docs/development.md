# Development

```sh
git clone https://github.com/plazorax/wp-fleet-monitor.git
cd wp-fleet-monitor
npm ci
npm run check        # typecheck, lint, test, build
node dist/cli.js --config examples/fleet.yml
```

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). |
| `npm run lint` | ESLint with `typescript-eslint` `strictTypeChecked`, then `prettier --check`. |
| `npm run format` | Prettier, writing changes. |
| `npm test` | Vitest, no network access. |
| `npm run build` | `tsc` to `dist/` (ES modules with declarations). |

CI runs the same steps on Node 20, 22 and 24 ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

## Layout

```text
src/
  cli.ts            entry point (bin)
  main.ts           argument parsing, output, Slack, exit code
  config.ts         YAML loading and validation
  run.ts            runs all sites with a concurrency limit, builds the report
  site.ts           requests for one site; turns responses into check results
  checks/           pure severity rules: http, tls, wordpress, rest, plugin
  detect.ts         WordPress fingerprints (generator tag, feed, Link header, REST index, readme)
  version.ts        version parsing and comparison
  wporg.ts          WordPress.org API client with per-run caching
  http.ts, tls.ts   HTTP client with timeouts, TLS certificate probe
  errors.ts         readable messages for Node network errors
  report/           console, Markdown and JSON renderers
  slack.ts          webhook payload and delivery
```

## Testing approach

Network access is behind three injected dependencies, so the tests never open a socket:

- `fetch` — a route table in `test/helpers.ts` returns real `Response` objects; anything not
  listed is a 404, and every requested URL is recorded so tests can assert what was *not* fetched.
- `TlsProbe` — a function returning certificate details, mocked with `vi.fn`.
- a clock — fixed, so response times and "days left" are deterministic.

The severity rules in `src/checks/` are pure functions and are tested with tables of inputs
and expected statuses. The real `probeCertificate` in `src/tls.ts` is not unit-tested; it was
exercised by running the CLI against live hosts (see [checks.md](checks.md#what-was-observed-on-live-sites)).

## Releasing

Not published to npm. Users install from GitHub, where the `prepare` script builds `dist/`.
The GitHub Action builds from source on every run (see [github-action.md](github-action.md)).
