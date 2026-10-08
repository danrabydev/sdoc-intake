/**
 * In-process test tracing: the production wiring (`telemetry/tracing.ts`: provider, propagator,
 * context manager, instrumentation list) with an in-memory exporter instead of OTLP. Test-only;
 * excluded from the build.
 */
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { startTracing } from "../telemetry/tracing.js";

let exporter: InMemorySpanExporter | null = null;

/** Idempotent — called once by otel-preload before any test file imports `pg`. */
export function startTestOpenTelemetry(): InMemorySpanExporter {
  if (exporter) {
    exporter.reset();
    return exporter;
  }
  process.env.REQALM_OTEL_TEST_MEMORY = "true";
  exporter = new InMemorySpanExporter();
  startTracing({ serviceName: "reqalm-test", spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return exporter;
}

export function resetTelemetrySpans(): void {
  exporter?.reset();
}

export function finishedSpans() {
  return exporter?.getFinishedSpans() ?? [];
}
