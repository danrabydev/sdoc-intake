/**
 * OpenTelemetry bootstrap — load before application modules (`node --import` / tsx `--import`).
 * Off by default: when no OTLP endpoint is configured this module imports nothing from the SDK,
 * starts nothing and opens no sockets (the API stays on its no-op provider).
 */
import { isOtelExportEnabled } from "./otel-env.js";

function shouldBootstrapSdk(): boolean {
  if (process.env.REQALM_OTEL_DISABLE === "true" || process.env.OTEL_SDK_DISABLED === "true") {
    return false;
  }
  // In-process tests start their own provider (src/test/otel-testing.ts) with an in-memory exporter.
  if (process.env.REQALM_OTEL_TEST_MEMORY === "true") return false;
  return isOtelExportEnabled();
}

if (shouldBootstrapSdk()) {
  const [api, { OTLPTraceExporter }, { BatchSpanProcessor }, { startTracing }] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/sdk-trace-node"),
    import("./tracing.js"),
  ]);
  if (process.env.OTEL_LOG_LEVEL === "debug") {
    api.diag.setLogger(new api.DiagConsoleLogger(), api.DiagLogLevel.DEBUG);
  }

  // The exporter reads OTEL_EXPORTER_OTLP_(TRACES_)ENDPOINT / _HEADERS itself.
  const provider = startTracing({
    serviceName: "reqalm",
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });

  const shutdown = async () => {
    try {
      await provider.shutdown();
    } catch {
      /* ignore */
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("beforeExit", shutdown);
}
