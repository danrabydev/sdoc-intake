import { context, trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_SERVER_ADDRESS,
  ATTR_URL_FULL,
} from "@opentelemetry/semantic-conventions";
import type { KeyProvider } from "../key/provider.js";

const TRACER_NAME = "reqalm.openbao";

export function traceKeyProvider(inner: KeyProvider, dependencyName = "openbao"): KeyProvider {
  const tracer = trace.getTracer(TRACER_NAME);
  return {
    ensureReady: () =>
      tracer.startActiveSpan(
        "key.ensureReady",
        { kind: SpanKind.CLIENT, attributes: { "dependency.name": dependencyName } },
        async (span) => {
          try {
            await inner.ensureReady();
          } catch (err) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            throw err;
          } finally {
            span.end();
          }
        },
      ),
    wrapSecret: (plaintext, purpose) =>
      tracer.startActiveSpan(
        "key.wrapSecret",
        {
          kind: SpanKind.CLIENT,
          attributes: { "dependency.name": dependencyName, "key.purpose": purpose },
        },
        async (span) => {
          try {
            return await inner.wrapSecret(plaintext, purpose);
          } catch (err) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            throw err;
          } finally {
            span.end();
          }
        },
      ),
    unwrapSecret: (ciphertext, purpose) =>
      tracer.startActiveSpan(
        "key.unwrapSecret",
        {
          kind: SpanKind.CLIENT,
          attributes: { "dependency.name": dependencyName, "key.purpose": purpose },
        },
        async (span) => {
          try {
            return await inner.unwrapSecret(ciphertext, purpose);
          } catch (err) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            throw err;
          } finally {
            span.end();
          }
        },
      ),
  };
}

/** Attribute helper for undici/fetch spans — no secrets in URLs. */
export function openBaoSpanAttributes(method: string, url: string): Record<string, string> {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "unknown";
  }
  return {
    [ATTR_HTTP_REQUEST_METHOD]: method,
    [ATTR_URL_FULL]: url.split("?")[0] ?? url,
    [ATTR_SERVER_ADDRESS]: host,
    "dependency.name": "openbao",
  };
}

/** Run fetch under an explicit dependency span (used by OpenBao HTTP calls). */
export async function fetchWithDependencySpan(
  operation: string,
  method: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    operation,
    { kind: SpanKind.CLIENT, attributes: openBaoSpanAttributes(method, url) },
    async (span) => {
      try {
        return await fetch(url, init);
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function activeSpanTraceId(): string | null {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId ?? null;
}
