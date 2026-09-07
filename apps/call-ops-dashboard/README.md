# Call operations dashboard

The dashboard reads `EXPO_PUBLIC_API_URL` from the root Velora-Mobile `.env` or `.env.local`, matching the mobile app's API gateway URL.

```bash
cd apps/call-ops-dashboard
pnpm install --frozen-lockfile
pnpm dev
```

The authenticated ADMIN dashboard now has two observability layers:

- **System observability** — Prometheus-backed health, process RAM/heap/CPU, event-loop p99, RPC throughput, error rate and p95 latency. It refreshes every 15 seconds and can display 1h, 6h or 24h history.
- **Application telemetry** — existing call setup, media readiness, QoE, failures, recent call legs and per-call timeline.

The browser never talks to Prometheus directly. System metrics follow this path:

```text
call-ops-dashboard
  -> API Gateway /monitoring/*
  -> monitoring-service
  -> Prometheus
```

Required backend endpoints:

```text
GET /monitoring/overview
GET /monitoring/timeseries?metric=...&from=...&to=...&stepSeconds=...
```

Both endpoints use the same ADMIN session already required by the call operations dashboard. Arbitrary PromQL is not accepted by the browser-facing API.
