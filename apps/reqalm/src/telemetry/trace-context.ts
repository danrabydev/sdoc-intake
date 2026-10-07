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

/** Pino mixin: correlate every log line with the active trace. */
export function traceLogFields(): { trace_id?: string; span_id?: string } {
  const ids = activeTraceIds();
  return ids ? { trace_id: ids.traceId, span_id: ids.spanId } : {};
}

export function setSpanError(span: Span, message: string): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.recordException(new Error(message));
}
