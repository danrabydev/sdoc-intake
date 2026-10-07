/**
 * OpenTelemetry bootstrap — load before application modules (`node --import` / tsx `--import`).
 * Cheap no-op when export is disabled.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { getFastifyOtelInstrumentation } from "./fastify-otel.js";
import { isOtelExportEnabled, serviceNameFromEnv } from "./otel-env.js";
import { getAsyncContextManager } from "./context-manager.js";

let sdk: NodeSDK | null = null;

export function isOtelSdkStarted(): boolean {
  return sdk !== null;
}

function shouldBootstrapSdk(): boolean {
  if (process.env.REQALM_OTEL_DISABLE === "true") return false;
  // In-process tests use telemetry/testing.ts instead of this register hook.
  if (process.env.REQALM_OTEL_TEST_MEMORY === "true") return false;
  return isOtelExportEnabled();
}

if (shouldBootstrapSdk()) {
  if (process.env.OTEL_LOG_LEVEL === "debug") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const exporter =
    process.env.REQALM_OTEL_TEST_MEMORY === "true"
      ? undefined
      : new OTLPTraceExporter();

  sdk = new NodeSDK({
    contextManager: getAsyncContextManager(),
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceNameFromEnv(),
    }),
    traceExporter: exporter,
    instrumentations: [
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      getFastifyOtelInstrumentation() as never,
    ],
  });
  sdk.start();

  const shutdown = async () => {
    try {
      await sdk?.shutdown();
    } catch {
      /* ignore */
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("beforeExit", shutdown);
}
