import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { getFastifyOtelInstrumentation } from "./fastify-otel.js";
import { getAsyncContextManager } from "./context-manager.js";

function pgInstrumentation(): PgInstrumentation {
  return new PgInstrumentation({ enhancedDatabaseReporting: false });
}

let exporter: InMemorySpanExporter | null = null;
let sdk: NodeSDK | null = null;

/** Idempotent — safe from otel-preload and individual test suites. */
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
    instrumentations: [
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      pgInstrumentation(),
      getFastifyOtelInstrumentation() as never,
    ],
  });
  sdk.start();
  return exporter;
}

/** @deprecated use startTestOpenTelemetry */
export const setupInMemoryTelemetry = startTestOpenTelemetry;

export function resetTelemetrySpans(): void {
  exporter?.reset();
}

export function finishedSpans() {
  return exporter?.getFinishedSpans() ?? [];
}

export async function shutdownTestTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = null;
  exporter = null;
  delete process.env.REQALM_OTEL_TEST_MEMORY;
}
