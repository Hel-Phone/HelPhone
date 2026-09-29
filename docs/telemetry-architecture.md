# Telemetry and event delivery

## Distributed tracing

The backend starts the OpenTelemetry Node SDK before creating the Express app. HTTP and Express auto-instrumentation propagate W3C Trace Context. Requests carrying a valid `traceparent` receive an `x-trace-id` response header, and structured request logs include the same trace ID. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an OTLP/HTTP collector to export traces; without it, instrumentation and propagation remain enabled but spans are not exported.

The React error boundary creates a W3C trace context for each captured render error and submits only the bounded error message and component stack to `POST /api/telemetry/errors`. The backend logs the trace ID with that report. Do not include wallet secrets, request form contents, or authentication tokens in client telemetry.

## Prometheus

`GET /metrics` uses Prometheus text exposition format. It includes the request counter and duration histogram plus `helphone_soroban_rpc_duration_seconds` and `helphone_zk_proof_duration_seconds`. Labels use route templates or fixed operation names; raw URLs, wallet addresses, and user IDs are never labels. Set `METRICS_BEARER_TOKEN` when the endpoint is reachable from outside a private monitoring network.

## WebSocket event relay

`GET /events/ws` upgrades to WebSocket. The relay supports the request lifecycle topics and responds to a `subscribe` message with an acknowledgement. A validated `tenant` query parameter filters events that include a matching tenant ID; events without a tenant ID are not sent to tenant-filtered clients. Heartbeats remove dead connections, and clients exceeding the bounded send buffer are disconnected.

When `REDIS_URL` is configured, events are published on `helphone:contract-events:v1` and each server process fans them out to its local sockets. A short Redis `SET NX` marker deduplicates event IDs produced by multiple pollers. Without Redis, the relay works within one process only. `node server/tests/ws-cluster.js` opens 1,000 clients across the three URLs supplied in `WS_CLUSTER_URLS` to exercise a deployed cluster.
