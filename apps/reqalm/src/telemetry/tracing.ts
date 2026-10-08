/**
 * The one tracing wiring for production (`register.ts`, OTLP) and tests (`src/test/otel-testing.ts`,
 * in-memory): tracer provider, W3C traceparent/baggage propagation, AsyncLocalStorage context and
 * the shared instrumentation list. Only the span processor differs; both are wrapped in
 * {@link SafeSpanProcessor}.
 */
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  defaultResource,
  detectResources,
  envDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { NodeTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { createInstrumentations } from "./instrumentations.js";
import { SafeSpanProcessor } from "./safe-span-processor.js";

export function startTracing(opts: {
  serviceName: string;
  spanProcessors: SpanProcessor[];
}): NodeTracerProvider {
  // OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES (env detector) override the default name.
  const resource = defaultResource()
    .merge(resourceFromAttributes({ [ATTR_SERVICE_NAME]: opts.serviceName }))
    .merge(detectResources({ detectors: [envDetector] }));
  // Every exporter sees only the sanitized span (generic error text, no raw exception, no invalid ids).
  const spanProcessors = opts.spanProcessors.map((p) => new SafeSpanProcessor(p));
  const provider = new NodeTracerProvider({ resource, spanProcessors });
  // Defaults: W3C trace context + baggage propagator, AsyncLocalStorage context manager.
  provider.register();
  registerInstrumentations({ tracerProvider: provider, instrumentations: createInstrumentations() });
  return provider;
}
