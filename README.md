# Whimsy's Warden — Go Health Monitor

A portfolio-grade availability monitor built around a bounded Go worker pool and deployed at the Cloudflare edge. It checks John Bieniek's production applications and stable beta deployments, reports status and latency, and presents the results in a responsive operational dashboard.

Production is mounted into the Whimsy site at
[`experiencewhimsy.com/warden/`](https://experiencewhimsy.com/warden/). The
standalone Worker URL remains available as an operational fallback.

## Engineering highlights

- Concurrent Go probe engine with bounded workers, cancellation, connection reuse, redirect limits, TLS minimums, and deterministic result ordering.
- Shared declarative target inventory for production and beta environments.
- Cloudflare Worker cron checks every five minutes and persists the latest snapshot in KV.
- Transition-based alerts to Whimsy when a target is down or exceeds 500 ms, with duplicate suppression in KV.
- Manual edge refresh, structured logs, no-store API responses, and static assets served by Workers.
- Accessible, dependency-free dashboard with production/beta filtering.

## Run the Go monitor

```powershell
go run ./cmd/healthmon -workers 8 -timeout 8s
```

## Test and deploy

```powershell
go test ./...
npm install
npm run types
npm run check
npm run deploy
```

Production deploys from `master` with `npm run deploy`. The public beta uses
the `develop` branch and deploys independently with `npm run deploy:develop`.
The beta has its own KV namespace and no alerting cron, so it cannot duplicate
production incident email.

Targets live in [`config/targets.json`](config/targets.json). Add stable health URLs there; avoid ephemeral deployment hashes.
