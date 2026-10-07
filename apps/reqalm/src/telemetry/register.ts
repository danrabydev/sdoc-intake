/**
 * OpenTelemetry bootstrap — load before application modules (`node --import` / tsx `--import`).
 * Off by default: when no OTLP endpoint is configured this module imports nothing from the SDK,
 * starts nothing and opens no sockets (the API stays on its no-op provider).
 */
import { isOtelExportEnabled, serviceNameFromEnv } from "./otel-env.js";

function shouldBootstrapSdk(): boolean {
  if (process.env.REQALM_OTEL_DISABLE === "true") return false;
  // In-process tests start their own SDK (src/test/otel-testing.ts) with an in-memory exporter.
  if (process.env.REQALM_OTEL_TEST_MEMORY === "true") return false;
  return isOtelExportEnabled();
}

if (shouldBootstrapSdk()) {
  const [api, { OTLPTraceExporter }, { resourceFromAttributes }, { NodeSDK }, semconv, inst, cm] =
    await Promise.all([
      import("@opentelemetry/api"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/semantic-conventions"),
      import("./instrumentations.js"),
      import("./context-manager.js"),
    ]);
  if (process.env.OTEL_LOG_LEVEL === "debug") {
    api.diag.setLogger(new api.DiagConsoleLogger(), api.DiagLogLevel.DEBUG);
  }

  const sdk = new NodeSDK({
    contextManager: cm.getAsyncContextManager(),
    resource: resourceFromAttributes({
      [semconv.ATTR_SERVICE_NAME]: serviceNameFromEnv(),
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: inst.createInstrumentations(),
  });
  sdk.start();

  const shutdown = async () => {
    try {
      await sdk.shutdown();
    } catch {
      /* ignore */
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("beforeExit", shutdown);
}
