import { context, trace, SpanStatusCode, type Span } from "@opentelemetry/api";

export type TraceIds = {
  traceId: string;
  spanId: string;
};

export function activeTraceIds(): TraceIds | null {
  const span = trace.getSpan(context.active());
  if (!span) return null;
  const sc = span.spanContext();
  if (!sc.traceId || sc.traceId === "00000000000000000000000000000000") return null;
  return { traceId: sc.traceId, spanId: sc.spanId };
}

export function setSpanError(span: Span, message: string): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.recordException(new Error(message));
}
