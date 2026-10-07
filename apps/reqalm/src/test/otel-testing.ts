/**
 * In-process test SDK: same instrumentations and context manager as production
 * (`telemetry/register.ts`), with an in-memory exporter instead of OTLP. Test-only; excluded from
 * the build.
 */
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { getAsyncContextManager } from "../telemetry/context-manager.js";
import { createInstrumentations } from "../telemetry/instrumentations.js";

let exporter: InMemorySpanExporter | null = null;
let sdk: NodeSDK | null = null;

/** Idempotent — called once by otel-preload before any test file imports `pg`. */
export function startTestOpenTelemetry(): InMemorySpanExporter {
  if (sdk) {
    exporter?.reset();
    return exporter!;
  }
  process.env.REQALM_OTEL_TEST_MEMORY = "true";
  exporter = new InMemorySpanExporter();
  sdk = new NodeSDK({
    contextManager: getAsyncContextManager(),
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "reqalm-test" }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    instrumentations: createInstrumentations(),
  });
  sdk.start();
  return exporter;
}

export function resetTelemetrySpans(): void {
  exporter?.reset();
}

export function finishedSpans() {
  return exporter?.getFinishedSpans() ?? [];
}
