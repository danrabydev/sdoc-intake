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

/** Status description of every failed span; the error itself is only in the server log. */
export const SAFE_SPAN_ERROR_MESSAGE = "operation failed";

/** Mark a span failed without exporting raw exception or service error text (logs retain detail). */
export function setSpanError(span: Span, errorKind: string): void {
  const message = SAFE_SPAN_ERROR_MESSAGE;
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.setAttribute("reqalm.error_kind", errorKind);
  span.recordException({ name: errorKind, message });
}
