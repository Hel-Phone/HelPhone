import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

let sdk;

export function initializeTelemetry() {
  if (sdk) return;
  const configuredEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const endpoint = configuredEndpoint
    ? configuredEndpoint.endsWith("/v1/traces")
      ? configuredEndpoint
      : `${configuredEndpoint.replace(/\/$/, "")}/v1/traces`
    : undefined;
  sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
    ...(endpoint ? { traceExporter: new OTLPTraceExporter({ url: endpoint }) } : {}),
  });
  sdk.start();
}

export function traceIdFromRequest(req) {
  const traceparent = req.get?.("traceparent") || req.headers?.traceparent;
  const match = typeof traceparent === "string" &&
    traceparent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i);
  return match && !/^0+$/.test(match[1]) ? match[1].toLowerCase() : null;
}

export function telemetryErrorHandler(req, res) {
  const traceId = traceIdFromRequest(req);
  const { message, componentStack } = req.body || {};
  console.error(JSON.stringify({
    event: "client_error",
    traceId,
    message: typeof message === "string" ? message.slice(0, 500) : "Unknown client error",
    componentStack: typeof componentStack === "string" ? componentStack.slice(0, 2000) : undefined,
    timestamp: new Date().toISOString(),
  }));
  res.status(202).json({ accepted: true, traceId });
}

export async function shutdownTelemetry() {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
