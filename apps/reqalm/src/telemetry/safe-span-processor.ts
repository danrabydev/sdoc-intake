import { SpanStatusCode, type Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { redactInvalidPathParamIds } from "../http/project-id.js";
import { SAFE_SPAN_ERROR_MESSAGE } from "./trace-context.js";

const URL_ATTRIBUTES = ["url.path", "url.full", "http.target", "http.url"] as const;

/**
 * What a span looks like when exported. Instrumentations we do not own (@fastify/otel request and
 * handler spans, pg, undici, the OpenBao dependency span) put `error.message` into the status and
 * record the raw exception with its stack; and the http/Fastify spans carry the raw URL. So for
 * every span: an ERROR status keeps its code with a generic description, exception events keep only
 * `exception.type`, and invalid slug path params in URL attributes are redacted.
 */
export function safeSpanView(span: ReadableSpan): ReadableSpan {
  const status =
    span.status.code === SpanStatusCode.ERROR
      ? { code: SpanStatusCode.ERROR, message: SAFE_SPAN_ERROR_MESSAGE }
      : span.status;
  const events = span.events.map((e) =>
    e.name === "exception"
      ? { ...e, attributes: { "exception.type": String(e.attributes?.["exception.type"] ?? "Error") } }
      : e,
  );
  const attributes = { ...span.attributes };
  for (const key of URL_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === "string") attributes[key] = redactInvalidPathParamIds(value);
  }
  return Object.create(span, {
    status: { value: status, enumerable: true },
    events: { value: events, enumerable: true },
    attributes: { value: attributes, enumerable: true },
  }) as ReadableSpan;
}

/** Wraps the exporting processor so only the safe view of a span leaves the process. */
export class SafeSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    this.inner.onEnd(safeSpanView(span));
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
